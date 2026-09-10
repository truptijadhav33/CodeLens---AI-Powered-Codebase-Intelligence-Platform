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

const router = express.Router();

const MAX_REPO_FILES = parseInt(process.env.MAX_REPO_FILES || "1500", 10);
const MAX_REPO_SIZE_MB = parseInt(process.env.MAX_REPO_SIZE_MB || "50", 10);
const MAX_REPO_SIZE_BYTES = MAX_REPO_SIZE_MB * 1024 * 1024;
const MAX_FILE_BYTES = 500 * 1024;
const INSERT_BATCH_SIZE = 100;

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