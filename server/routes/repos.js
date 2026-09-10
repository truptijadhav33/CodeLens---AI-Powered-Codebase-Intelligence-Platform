const express = require("express");
const mongoose = require("mongoose");
const requireAuth = require("../middleware/requireAuth");
const Repository = require("../models/Repository");
const RepositoryFile = require("../models/RepositoryFile");
const github = require("../services/github");
const { filterRepoFiles } = require("../services/repoFilter");

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