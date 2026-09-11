const express = require("express");
const mongoose = require("mongoose");
const requireAuth = require("../middleware/requireAuth");
const Repository = require("../models/Repository");
const RepositoryFile = require("../models/RepositoryFile");
const FileAnalysis = require("../models/FileAnalysis");
const github = require("../services/github");
const { filterRepoFiles } = require("../services/repoFilter");
const { parseFile, getLanguage } = require("../services/codeParser");
const { analyzeFile } = require("../services/complexity");
const { lintContent } = require("../services/lintService");
const { buildDependencyGraph } = require("../services/dependencyGraph");
const Chunk = require("../models/Chunk");
const ChatMessage = require("../models/ChatMessage");
const { isEligibleFile, chunkFile, estimateTokens } = require("../services/chunker");
const {
  embedChunks,
  hashContent,
  GEMINI_EMBED_MODEL,
  EMBEDDING_DIMENSION,
  DailyQuotaError,
} = require("../services/embeddings");
const { retrieveRelevantChunks } = require("../services/retrieval");
const { generateAnswer, explainIssue } = require("../services/gemini");
const { detectIssues } = require("../services/issueDetection");
const Issue = require("../models/Issue");

const router = express.Router();

const MAX_REPO_FILES = parseInt(process.env.MAX_REPO_FILES || "1500", 10);
const MAX_REPO_SIZE_MB = parseInt(process.env.MAX_REPO_SIZE_MB || "50", 10);
const MAX_REPO_SIZE_BYTES = MAX_REPO_SIZE_MB * 1024 * 1024;
const MAX_FILE_BYTES = 500 * 1024;
const INSERT_BATCH_SIZE = 100;

const ASK_RATE_LIMIT = 10;
const ASK_WINDOW_MS = 60 * 1000;
const askRateStore = new Map();

const EXPLAIN_RATE_LIMIT = 10;
const EXPLAIN_WINDOW_MS = 60 * 1000;
const explainRateStore = new Map();

const SEVERITY_RANK = { high: 0, medium: 1, low: 2 };

function checkRateLimit(store, userId, limit, windowMs) {
  const key = String(userId);
  const now = Date.now();
  const stamps = (store.get(key) || []).filter((t) => now - t < windowMs);
  if (stamps.length >= limit) return false;
  stamps.push(now);
  store.set(key, stamps);
  return true;
}

function checkAskRateLimit(userId) {
  return checkRateLimit(askRateStore, userId, ASK_RATE_LIMIT, ASK_WINDOW_MS);
}

function checkExplainRateLimit(userId) {
  return checkRateLimit(explainRateStore, userId, EXPLAIN_RATE_LIMIT, EXPLAIN_WINDOW_MS);
}

router.use(requireAuth);

function serializeRepo(doc) {
  return {
    id: String(doc._id),
    owner: doc.owner,
    name: doc.name,
    fullName: doc.fullName,
    description: doc.description,
    language: doc.language,
    defaultBranch: doc.defaultBranch,
    isPrivate: doc.isPrivate,
    topics: doc.topics || [],
    starCount: doc.starCount,
    fileCount: doc.fileCount,
    totalSizeBytes: doc.totalSizeBytes,
    status: doc.status,
    ingestedAt: doc.ingestedAt,
    errorMessage: doc.errorMessage,
    analysisStatus: doc.analysisStatus || "none",
    analysisCompletedAt: doc.analysisCompletedAt,
    analysisError: doc.analysisError,
    embeddingStatus: doc.embeddingStatus || "none",
    embeddingCompletedAt: doc.embeddingCompletedAt,
    embeddingCount: doc.embeddingCount || 0,
    embeddingError: doc.embeddingError,
  };
}

function serializeFile(doc) {
  return { id: String(doc._id), path: doc.path, type: doc.type, size: doc.size };
}

async function insertFilesBatch(repoId, files) {
  for (let i = 0; i < files.length; i += INSERT_BATCH_SIZE) {
    const batch = files.slice(i, i + INSERT_BATCH_SIZE);
    await RepositoryFile.insertMany(batch, { ordered: false });
  }
}

function buildAnalysisSummary(analysisDocs, totalFiles) {
  const analyzedFiles = analysisDocs.length;
  const totalLintIssues = analysisDocs.reduce((sum, f) => sum + f.lintIssues.length, 0);
  const averageComplexity =
    analyzedFiles === 0 ? 0 : analysisDocs.reduce((sum, f) => sum + f.complexityScore, 0) / analyzedFiles;
  return {
    totalFiles,
    analyzedFiles,
    unsupportedFiles: Math.max(totalFiles - analyzedFiles, 0),
    totalLintIssues,
    averageComplexity: Math.round(averageComplexity * 100) / 100,
  };
}

function serializeAnalysisFile(doc) {
  return {
    id: String(doc._id),
    path: doc.path,
    language: doc.language,
    linesOfCode: doc.linesOfCode,
    complexityScore: doc.complexityScore,
    lintIssueCount: doc.lintIssues.length,
    status: doc.status,
    parseError: doc.parseError || null,
  };
}

function analysisMessage(summary) {
  if (summary.totalFiles === 0) {
    return "Repository has no ingested files.";
  }
  if (summary.analyzedFiles === 0) {
    return `No JavaScript/TypeScript files found to analyze — ${summary.unsupportedFiles} file(s) skipped as unsupported language.`;
  }
  if (summary.unsupportedFiles > 0) {
    return `${summary.unsupportedFiles} non-JavaScript/TypeScript file(s) skipped (unsupported language).`;
  }
  return null;
}

async function analyzeRepository(repoDoc) {
  const repoFiles = await RepositoryFile.find({ repositoryId: repoDoc._id }).lean();
  const supportedFiles = repoFiles.filter((f) => getLanguage(f.path));
  const unsupportedFiles = repoFiles.length - supportedFiles.length;

  const analysisDocs = [];
  for (const file of supportedFiles) {
    const parseResult = parseFile(file.content, file.path);
    const base = {
      repositoryId: repoDoc._id,
      path: file.path,
      language: parseResult.language,
      linesOfCode: parseResult.linesOfCode || 0,
    };

    if (parseResult.unsupported) {
      continue;
    }
    if (parseResult.parseError) {
      const lint = await lintContent(file.content, file.path);
      analysisDocs.push({
        ...base,
        status: "parse_error",
        parseError: parseResult.parseError,
        complexityScore: 0,
        lintIssues: lint.lintIssues,
      });
      continue;
    }

    const complexity = analyzeFile(parseResult);
    const lint = await lintContent(file.content, file.path);
    analysisDocs.push({
      ...base,
      status: "analyzed",
      imports: parseResult.imports,
      exports: parseResult.exports,
      functions: complexity.functions,
      classes: parseResult.classes,
      complexityScore: complexity.complexityScore,
      lintIssues: lint.lintIssues,
      analyzedAt: new Date(),
    });
  }

  // Replace stale results from any previous analysis run.
  await FileAnalysis.deleteMany({ repositoryId: repoDoc._id });
  await insertDocsBatch(FileAnalysis, analysisDocs);

  return { analysisDocs, unsupportedFiles, totalFiles: repoFiles.length };
}

function insertDocsBatch(Model, docs) {
  const tasks = [];
  for (let i = 0; i < docs.length; i += INSERT_BATCH_SIZE) {
    tasks.push(Model.insertMany(docs.slice(i, i + INSERT_BATCH_SIZE), { ordered: false }));
  }
  return Promise.all(tasks);
}

function serializeIssue(doc) {
  return {
    id: String(doc._id),
    type: doc.type,
    severity: doc.severity,
    filePath: doc.filePath,
    relatedFilePath: doc.relatedFilePath || null,
    message: doc.message,
    detail: doc.detail || {},
    aiExplanation: doc.aiExplanation || null,
    aiSuggestion: doc.aiSuggestion || null,
    createdAt: doc.createdAt,
  };
}

async function summarizeIssues(repositoryId) {
  const [typeRows, severityRows] = await Promise.all([
    Issue.aggregate([
      { $match: { repositoryId } },
      { $group: { _id: "$type", count: { $sum: 1 } } },
    ]),
    Issue.aggregate([
      { $match: { repositoryId } },
      { $group: { _id: "$severity", count: { $sum: 1 } } },
    ]),
  ]);
  const byType = {};
  const bySeverity = {};
  for (const r of typeRows) byType[r._id] = r.count;
  for (const r of severityRows) bySeverity[r._id] = r.count;
  const total = Object.values(byType).reduce((sum, n) => sum + n, 0);
  return { total, byType, bySeverity };
}

// Pulls a bounded excerpt of a repository file around the issue's location so
// the AI explanation is grounded in the actual code (no full-file blast).
async function issueExcerpt(repositoryId, filePath, anchorLine) {
  const file = await RepositoryFile.findOne({ repositoryId, path: filePath }).lean();
  if (!file) return null;
  const lines = file.content.split("\n");
  const center = anchorLine
    ? Math.min(Math.max(anchorLine - 1, 0), Math.max(lines.length - 1, 0))
    : 0;
  const start = Math.max(0, center - 40);
  const end = Math.min(lines.length, center + 80);
  return { path: filePath, excerpt: lines.slice(start, end).join("\n"), startLine: start + 1 };
}

function anchorLineFor(issue) {
  if (issue.type === "lint") return issue.detail?.line || 0;
  if (issue.type === "complexity") return issue.detail?.issueLine || (issue.detail?.functions?.[0]?.line) || 0;
  if (issue.type === "duplication") return issue.detail?.lineA || 0;
  return 0;
}

function splitExplanation(raw) {
  const text = (raw || "").trim();
  const suggestionIdx = text.search(/SUGGESTION\s*:/i);
  if (suggestionIdx === -1) return { explanation: text, suggestion: "" };
  const explanation = text.slice(0, suggestionIdx).replace(/EXPLANATION\s*:/i, "").trim();
  const suggestion = text.slice(suggestionIdx).replace(/SUGGESTION\s*:/i, "").trim();
  return { explanation, suggestion };
}

// List repositories the user owns or collaborates on (all pages).
router.get("/", async (req, res, next) => {
  try {
    const repos = await github.listRepos(req.user.accessToken);
    res.json({ repos });
  } catch (err) {
    next(err);
  }
});

// Fetch + store raw source content for a repository. Content is stored in the
// RepositoryFile collection (one doc per file) so the Repository document stays
// well under MongoDB's 16MB document cap.
router.post("/ingest", async (req, res, next) => {
  const { owner, repo } = req.body || {};

  if (!owner || typeof owner !== "string" || !repo || typeof repo !== "string") {
    return res.status(400).json({ error: "owner and repo are required in the request body" });
  }

  let repoDoc = null;

  try {
    const token = req.user.accessToken;
    const meta = await github.getRepo(token, owner, repo);
    const tree = await github.getFileTree(token, owner, repo, meta.defaultBranch);

    const filtered = filterRepoFiles(tree);

    // Guard before fetching any content (cheap check using tree sizes).
    if (filtered.length > MAX_REPO_FILES) {
      return res.status(400).json({
        error: `Repository has ${filtered.length} source files, exceeding MAX_REPO_FILES=${MAX_REPO_FILES}. Pick a smaller repository.`,
      });
    }
    const cleanedTotalBytes = filtered.reduce((sum, f) => sum + f.size, 0);
    if (cleanedTotalBytes > MAX_REPO_SIZE_BYTES) {
      return res.status(400).json({
        error: `Repository source content is ~${(cleanedTotalBytes / (1024 * 1024)).toFixed(1)} MB, exceeding MAX_REPO_SIZE_MB=${MAX_REPO_SIZE_MB}. Pick a smaller repository.`,
      });
    }

    repoDoc = await Repository.findOne({ ownerUserId: req.user._id, githubRepoId: meta.id });
    if (!repoDoc) {
      repoDoc = new Repository({
        ownerUserId: req.user._id,
        githubRepoId: meta.id,
        owner: meta.owner,
        name: meta.name,
        fullName: meta.fullName,
      });
    }

    repoDoc.set({
      owner: meta.owner,
      name: meta.name,
      fullName: meta.fullName,
      description: meta.description,
      language: meta.language,
      defaultBranch: meta.defaultBranch,
      isPrivate: meta.isPrivate,
      topics: meta.topics,
      starCount: meta.starCount,
      status: "ingesting",
      errorMessage: null,
    });
    await repoDoc.save();

    // Fetch content before touching existing file docs so a fetch failure does
    // not wipe the previously-ingested files.
    const files = [];
    let skipped = 0;
    for (const f of filtered) {
      if (f.size > MAX_FILE_BYTES) {
        skipped += 1;
        continue;
      }
      const content = await github.getBlobContent(token, meta.owner, meta.name, f.sha);
      const size = Buffer.byteLength(content);
      files.push({
        repositoryId: repoDoc._id,
        path: f.path,
        type: f.type,
        size,
        content,
      });
    }

    if (skipped > 0) console.warn(`Skipped ${skipped} file(s) over ${MAX_FILE_BYTES} bytes in ${meta.fullName}`);

    // Replace stale files from any previous ingest.
    await RepositoryFile.deleteMany({ repositoryId: repoDoc._id });
    await insertFilesBatch(repoDoc._id, files);

    repoDoc.fileCount = files.length;
    repoDoc.totalSizeBytes = files.reduce((sum, f) => sum + f.size, 0);
    repoDoc.status = "complete";
    repoDoc.ingestedAt = new Date();
    await repoDoc.save();

    res.status(201).json({ repository: serializeRepo(repoDoc) });
  } catch (err) {
    if (repoDoc && repoDoc._id) {
      try {
        await repoDoc.set({ status: "failed", errorMessage: err.message }).save();
      } catch {
        /* ignore secondary failure */
      }
    }
    if (err.status === 404) {
      return res.status(404).json({
        error: `Repository '${owner}/${repo}' was not found or is not accessible to your GitHub account.`,
      });
    }
    if (err.status >= 400 && err.status < 500) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
});

// Repositories already ingested by this user (lightweight list).
router.get("/mine", async (req, res, next) => {
  try {
    const repos = await Repository.find({ ownerUserId: req.user._id })
      .sort({ ingestedAt: -1 })
      .select({ __v: 0 })
      .lean();
    res.json({ repos: repos.map((r) => serializeRepo(r)) });
  } catch (err) {
    next(err);
  }
});

// Run deterministic code parsing + complexity + lint on an ingested repo.
router.post("/:id/analyze", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ error: "Repository not found" });
    }
    const repoDoc = await Repository.findOne({ _id: req.params.id, ownerUserId: req.user._id });
    if (!repoDoc) {
      return res.status(404).json({ error: "Repository not found" });
    }
    const existing = await RepositoryFile.countDocuments({ repositoryId: repoDoc._id });
    if (existing === 0) {
      return res.status(400).json({
        error: "Repository has no ingested files — run ingestion before analysis.",
      });
    }

    repoDoc.analysisStatus = "analyzing";
    repoDoc.analysisError = null;
    await repoDoc.save();

    try {
      const { analysisDocs, unsupportedFiles, totalFiles } = await analyzeRepository(repoDoc);

      repoDoc.analysisStatus = "complete";
      repoDoc.analysisCompletedAt = new Date();
      await repoDoc.save();

      const summary = buildAnalysisSummary(analysisDocs, totalFiles);
      summary.unsupportedFiles = unsupportedFiles;
      summary.message = analysisMessage(summary);
      res.status(201).json({
        repository: serializeRepo(repoDoc),
        summary,
        files: analysisDocs.map(serializeAnalysisFile),
      });
    } catch (err) {
      repoDoc.analysisStatus = "failed";
      repoDoc.analysisError = err.message;
      await repoDoc.save();
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

// Analysis summary + per-file results (light: no full lint detail).
router.get("/:id/analysis", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ error: "Repository not found" });
    }
    const repoDoc = await Repository.findOne({ _id: req.params.id, ownerUserId: req.user._id }).lean();
    if (!repoDoc) {
      return res.status(404).json({ error: "Repository not found" });
    }
    const [analysisDocs, totalFiles] = await Promise.all([
      FileAnalysis.find({ repositoryId: repoDoc._id }).sort({ path: 1 }).lean(),
      RepositoryFile.countDocuments({ repositoryId: repoDoc._id }),
    ]);
    const summary = buildAnalysisSummary(analysisDocs, totalFiles);
    summary.message = analysisMessage(summary);
    res.json({
      repository: { id: String(repoDoc._id), analysisStatus: repoDoc.analysisStatus, analysisCompletedAt: repoDoc.analysisCompletedAt },
      summary,
      files: analysisDocs.map(serializeAnalysisFile),
    });
  } catch (err) {
    next(err);
  }
});

// Dependency graph derived from FileAnalysis imports (internal + external).
router.get("/:id/graph", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ error: "Repository not found" });
    }
    const repoDoc = await Repository.findOne({ _id: req.params.id, ownerUserId: req.user._id }).lean();
    if (!repoDoc) {
      return res.status(404).json({ error: "Repository not found" });
    }
    const hasAnalysis = await FileAnalysis.exists({ repositoryId: repoDoc._id });
    if (!hasAnalysis) {
      return res.status(400).json({
        error: "No analysis found — run code analysis before viewing the dependency graph.",
      });
    }
    const graph = await buildDependencyGraph(repoDoc._id);
    res.json(graph);
  } catch (err) {
    next(err);
  }
});

// Chunk + embed eligible files for RAG (JS/TS + markdown). Delete-then-insert.
router.post("/:id/embed", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ error: "Repository not found" });
    }
    const repoDoc = await Repository.findOne({ _id: req.params.id, ownerUserId: req.user._id });
    if (!repoDoc) return res.status(404).json({ error: "Repository not found" });

    const repoFiles = await RepositoryFile.find({ repositoryId: repoDoc._id }).lean();
    const eligibleFiles = repoFiles.filter((f) => isEligibleFile(f.path));
    if (eligibleFiles.length === 0) {
      return res.status(400).json({ error: "No eligible files to embed (JS/TS or markdown required)." });
    }

    const existingChunks = await Chunk.countDocuments({ repositoryId: repoDoc._id });
    const force = req.query.force === "true";
    if (existingChunks > 0 && !force) {
      const stale =
        repoDoc.embeddingCompletedAt &&
        repoDoc.analysisCompletedAt &&
        repoDoc.embeddingCompletedAt >= repoDoc.analysisCompletedAt;
      const upToDate = repoDoc.embeddingStatus === "complete" && (stale || !repoDoc.analysisCompletedAt);
      if (upToDate) {
        return res.status(409).json({
          error: "Embeddings already exist and repository has not been re-analyzed since. Use ?force=true to re-embed.",
          embeddingCount: existingChunks,
          embeddingCompletedAt: repoDoc.embeddingCompletedAt,
        });
      }
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: "GEMINI_API_KEY is not configured on the server." });
    }

    repoDoc.embeddingStatus = "embedding";
    repoDoc.embeddingError = null;
    await repoDoc.save();

    try {
      const analysisMap = new Map();
      const analyses = await FileAnalysis.find({ repositoryId: repoDoc._id }).lean();
      for (const a of analyses) analysisMap.set(a.path, a);

      const allChunks = [];
      for (const file of eligibleFiles) {
        const analysis = analysisMap.get(file.path) || null;
        const parts = chunkFile(file.content, file.path, analysis);
        for (let i = 0; i < parts.length; i++) {
          const content = parts[i];
          allChunks.push({
            repositoryId: repoDoc._id,
            path: file.path,
            chunkIndex: i,
            content,
            tokenCount: estimateTokens(content),
            contentHash: hashContent(content),
          });
        }
      }

      if (allChunks.length === 0) {
        throw new Error("Chunking produced no chunks");
      }

      // Reuse stored embeddings for unchanged chunks (content-hash skip) so iterative
      // re-embeds do not burn daily Gemini quota; only changed/new chunks are embedded.
      const { chunks: finalChunks, skipped, embedded } = await embedChunks(allChunks, "RETRIEVAL_DOCUMENT");

      await Chunk.deleteMany({ repositoryId: repoDoc._id });
      await insertDocsBatch(Chunk, finalChunks);

      repoDoc.embeddingStatus = "complete";
      repoDoc.embeddingCompletedAt = new Date();
      repoDoc.embeddingCount = finalChunks.length;
      await repoDoc.save();

      res.status(201).json({
        repository: serializeRepo(repoDoc),
        model: GEMINI_EMBED_MODEL,
        dimension: EMBEDDING_DIMENSION,
        chunksCreated: finalChunks.length,
        chunksSkipped: skipped,
        chunksEmbedded: embedded,
        eligibleFiles: eligibleFiles.length,
      });
    } catch (err) {
      repoDoc.embeddingStatus = "failed";
      repoDoc.embeddingError = err.message;
      await repoDoc.save();
      if (err instanceof DailyQuotaError) {
        // RPD quota resets at midnight Pacific — don't sit on retries that can't
        // succeed today. Return a clean, actionable 429.
        return res.status(429).json({ error: err.message });
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

// Embedding status (lightweight check for frontend).
router.get("/:id/embed-status", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: "Repository not found" });
    const repoDoc = await Repository.findOne({ _id: req.params.id, ownerUserId: req.user._id }).lean();
    if (!repoDoc) return res.status(404).json({ error: "Repository not found" });
    const chunkCount = await Chunk.countDocuments({ repositoryId: repoDoc._id });
    res.json({
      embeddingStatus: repoDoc.embeddingStatus || "none",
      embeddingCount: chunkCount,
      embeddingCompletedAt: repoDoc.embeddingCompletedAt,
      dimension: EMBEDDING_DIMENSION,
      model: GEMINI_EMBED_MODEL,
    });
  } catch (err) {
    next(err);
  }
});

// Chat history for this repo (owner-only, most recent first, paginated).
router.get("/:id/chat-history", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: "Repository not found" });
    const repoDoc = await Repository.findOne({ _id: req.params.id, ownerUserId: req.user._id }).lean();
    if (!repoDoc) return res.status(404).json({ error: "Repository not found" });
    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || "20", 10), 1), 50);
    const skip = (page - 1) * limit;
    const [messages, total] = await Promise.all([
      ChatMessage.find({ repositoryId: repoDoc._id, userId: req.user._id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      ChatMessage.countDocuments({ repositoryId: repoDoc._id, userId: req.user._id }),
    ]);
    res.json({
      messages: messages.map((m) => ({
        id: String(m._id),
        role: m.role,
        content: m.content,
        sourceFiles: m.sourceFiles || [],
        createdAt: m.createdAt,
      })),
      total,
      page,
      limit,
    });
  } catch (err) {
    next(err);
  }
});

// RAG Q&A — retrieve relevant chunks, call Gemini, store chat history. Rate limited.
router.post("/:id/ask", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: "Repository not found" });
    const repoDoc = await Repository.findOne({ _id: req.params.id, ownerUserId: req.user._id });
    if (!repoDoc) return res.status(404).json({ error: "Repository not found" });

    const { question } = req.body || {};
    if (!question || typeof question !== "string" || question.trim().length < 3) {
      return res.status(400).json({ error: "question is required (min 3 chars)" });
    }
    if (question.length > 2000) return res.status(400).json({ error: "question too long (max 2000 chars)" });

    if (!checkAskRateLimit(req.user._id)) {
      return res.status(429).json({ error: "Rate limit: max 10 questions per minute. Please wait." });
    }

    const chunkCount = await Chunk.countDocuments({ repositoryId: repoDoc._id });
    if (chunkCount === 0) {
      return res.status(400).json({ error: "No embeddings found — generate embeddings first via POST /:id/embed." });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: "GEMINI_API_KEY is not configured on the server." });
    }

    const tTotal = Date.now();
    let relevantChunks = [];
    let embedMs = 0;
    let vectorMs = 0;
    try {
      const retrieved = await retrieveRelevantChunks(repoDoc._id, question.trim());
      relevantChunks = retrieved.chunks;
      embedMs = retrieved.embedMs;
      vectorMs = retrieved.vectorMs;
    } catch (err) {
      // If vector index missing or not ready, surface a clear error
      if (err instanceof DailyQuotaError) {
        return res.status(429).json({ error: err.message });
      }
      return res.status(500).json({ error: `Retrieval failed: ${err.message}. Ensure the Atlas Vector Search index "vector_index" exists and is Ready.` });
    }

    if (relevantChunks.length === 0) {
      return res.status(500).json({ error: "No relevant chunks retrieved — try re-embedding." });
    }

    const sourceFiles = [...new Set(relevantChunks.map((c) => c.path))];
    let answer;
    let genMs = 0;
    const tGen = Date.now();
    try {
      const result = await generateAnswer(question.trim(), relevantChunks);
      answer = result.answer;
      genMs = Date.now() - tGen;
    } catch (err) {
      genMs = Date.now() - tGen;
      const totalMs = Date.now() - tTotal;
      console.log(`[ask] embed: ${embedMs}ms, vectorSearch: ${vectorMs}ms, generateContent: ${genMs}ms (failed), total: ${totalMs}ms`);
      // Surface 503 as 503 so the UI can show "high demand, try again" instead of generic 500
      if (/503|UNAVAILABLE|high demand/.test(err.message)) {
        return res.status(503).json({ error: "Gemini is currently overloaded (503). Please try again in a few seconds." });
      }
      throw err;
    }
    const totalMs = Date.now() - tTotal;
    console.log(`[ask] embed: ${embedMs}ms, vectorSearch: ${vectorMs}ms, generateContent: ${genMs}ms, total: ${totalMs}ms`);

    const userMsg = await ChatMessage.create({
      repositoryId: repoDoc._id,
      userId: req.user._id,
      role: "user",
      content: question.trim(),
    });
    const assistantMsg = await ChatMessage.create({
      repositoryId: repoDoc._id,
      userId: req.user._id,
      role: "assistant",
      content: answer,
      sourceFiles,
    });

    res.json({
      answer,
      sourceFiles,
      chunksUsed: relevantChunks.length,
      messages: [
        { id: String(userMsg._id), role: "user", content: userMsg.content, createdAt: userMsg.createdAt },
        { id: String(assistantMsg._id), role: "assistant", content: answer, sourceFiles, createdAt: assistantMsg.createdAt },
      ],
    });
  } catch (err) {
    next(err);
  }
});

// Run deterministic issue detection (no AI) and persist issues for this repo.
// Delete-then-insert is used so stale issues never linger after re-detection.
router.post("/:id/detect-issues", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: "Repository not found" });
    const repoDoc = await Repository.findOne({ _id: req.params.id, ownerUserId: req.user._id });
    if (!repoDoc) return res.status(404).json({ error: "Repository not found" });

    const hasAnalysis = await FileAnalysis.exists({ repositoryId: repoDoc._id });
    if (!hasAnalysis) {
      return res.status(400).json({ error: "No analysis found — run code analysis before detecting issues." });
    }

    const { issues } = await detectIssues(repoDoc._id);

    await Issue.deleteMany({ repositoryId: repoDoc._id });
    if (issues.length > 0) {
      const docs = issues.map((i) => ({
        repositoryId: repoDoc._id,
        type: i.type,
        severity: i.severity,
        filePath: i.filePath,
        relatedFilePath: i.relatedFilePath,
        message: i.message,
        detail: i.detail,
        aiExplanation: null,
        aiSuggestion: null,
      }));
      await insertDocsBatch(Issue, docs);
    }

    const summary = await summarizeIssues(repoDoc._id);
    res.status(201).json({
      repositoryId: String(repoDoc._id),
      message: summary.total === 0 ? "No issues detected." : "Issue detection complete.",
      ...summary,
    });
  } catch (err) {
    next(err);
  }
});

// List issues with optional type/severity filters, paginated, high severity first.
router.get("/:id/issues", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: "Repository not found" });
    const repoDoc = await Repository.findOne({ _id: req.params.id, ownerUserId: req.user._id }).lean();
    if (!repoDoc) return res.status(404).json({ error: "Repository not found" });

    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || "50", 10), 1), 100);
    const skip = (page - 1) * limit;

    const match = { repositoryId: repoDoc._id };
    if (req.query.type) match.type = req.query.type;
    if (req.query.severity) match.severity = req.query.severity;

    const pagePipeline = [
      { $match: match },
      {
        $addFields: {
          severityRank: {
            $switch: {
              branches: [
                { case: { $eq: ["$severity", "high"] }, then: 0 },
                { case: { $eq: ["$severity", "medium"] }, then: 1 },
              ],
              default: 2,
            },
          },
        },
      },
      { $sort: { severityRank: 1, createdAt: -1 } },
      {
        $facet: {
          data: [{ $skip: skip }, { $limit: limit }],
          total: [{ $count: "total" }],
        },
      },
    ];

    const [facetResults, summary] = await Promise.all([
      Issue.aggregate(pagePipeline),
      summarizeIssues(match.repositoryId),
    ]);
    const { data = [], total = [] } = facetResults[0] || {};
    const totalCount = total[0]?.total || 0;

    res.json({
      issues: data.map(serializeIssue),
      total: totalCount,
      page,
      limit,
      filters: { type: req.query.type || null, severity: req.query.severity || null },
      summary,
    });
  } catch (err) {
    next(err);
  }
});

// On-demand AI explanation for a single issue. Cached on the Issue doc and rate
// limited (same pattern as /ask) to protect free-tier Gemini quota.
router.post("/:id/issues/:issueId/explain", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id) || !mongoose.isValidObjectId(req.params.issueId)) {
      return res.status(404).json({ error: "Issue not found" });
    }
    const repoDoc = await Repository.findOne({ _id: req.params.id, ownerUserId: req.user._id });
    if (!repoDoc) return res.status(404).json({ error: "Repository not found" });

    const issue = await Issue.findOne({ _id: req.params.issueId, repositoryId: repoDoc._id });
    if (!issue) return res.status(404).json({ error: "Issue not found" });

    // Cache hit — return stored explanation without calling Gemini again.
    if (issue.aiExplanation) {
      return res.json({
        issue: serializeIssue(issue.toObject()),
        aiExplanation: issue.aiExplanation,
        aiSuggestion: issue.aiSuggestion,
        cached: true,
      });
    }

    if (!checkExplainRateLimit(req.user._id)) {
      return res.status(429).json({ error: "Rate limit: max 10 explanations per minute. Please wait." });
    }
    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: "GEMINI_API_KEY is not configured on the server." });
    }

    const primary = await issueExcerpt(repoDoc._id, issue.filePath, anchorLineFor(issue.toObject()));
    let related = null;
    if (issue.relatedFilePath) {
      related = await issueExcerpt(repoDoc._id, issue.relatedFilePath, issue.detail?.lineB || 0);
    }
    if (!primary) {
      // File content unreachable (deleted/not ingested) — nothing to ground an explanation in.
      const fallback = { explanation: "No file content available for this issue — cannot explain without code context.", suggestion: "" };
      issue.aiExplanation = fallback.explanation;
      issue.aiSuggestion = fallback.suggestion;
      await issue.save();
      return res.json({
        issue: serializeIssue(issue.toObject()),
        aiExplanation: fallback.explanation,
        aiSuggestion: fallback.suggestion,
      });
    }

    let result;
    try {
      result = await explainIssue({
        filePath: primary.path,
        excerpt: primary.excerpt,
        relatedFilePath: related?.path || null,
        relatedExcerpt: related?.excerpt || null,
        issueType: issue.type,
        message: issue.message,
      });
    } catch (err) {
      if (/503|UNAVAILABLE|high demand/.test(err.message)) {
        return res.status(503).json({ error: err.message });
      }
      throw err;
    }

    const { explanation, suggestion } = splitExplanation(result.answer);
    issue.aiExplanation = explanation;
    issue.aiSuggestion = suggestion;
    await issue.save();

    res.json({
      issue: serializeIssue(issue.toObject()),
      aiExplanation: explanation,
      aiSuggestion: suggestion,
      cached: false,
    });
  } catch (err) {
    next(err);
  }
});

// Single ingested repository: metadata + file list (paths/sizes only).
router.get("/:id", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ error: "Repository not found" });
    }
    const doc = await Repository.findOne({ _id: req.params.id, ownerUserId: req.user._id })
      .select({ __v: 0 })
      .lean();
    if (!doc) {
      return res.status(404).json({ error: "Repository not found" });
    }
    const files = await RepositoryFile.find({ repositoryId: doc._id })
      .select({ content: 0, _id: 1, __v: 0, createdAt: 0, updatedAt: 0 })
      .sort({ path: 1 })
      .lean();
    res.json({ repository: serializeRepo(doc), files: files.map(serializeFile) });
  } catch (err) {
    next(err);
  }
});

// Single ingested file with its content (used by later parsing/RAG phases).
router.get("/:id/files/:fileId", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id) || !mongoose.isValidObjectId(req.params.fileId)) {
      return res.status(404).json({ error: "File not found" });
    }
    const repoDoc = await Repository.findOne({ _id: req.params.id, ownerUserId: req.user._id })
      .select({ _id: 1 })
      .lean();
    if (!repoDoc) {
      return res.status(404).json({ error: "Repository not found" });
    }
    const file = await RepositoryFile.findOne({
      _id: req.params.fileId,
      repositoryId: repoDoc._id,
    })
      .select({ __v: 0, updatedAt: 0 })
      .lean();
    if (!file) {
      return res.status(404).json({ error: "File not found" });
    }
    res.json({
      file: {
        id: String(file._id),
        repositoryId: String(file.repositoryId),
        path: file.path,
        type: file.type,
        size: file.size,
        content: file.content,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;