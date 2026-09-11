/**
 * Full embed-path verification through the real route (POST /:id/embed).
 * The server runs with `node --watch`, so it auto-restarted with the new
 * embeddings.js (embeddingModel-aware skip, env-configurable model).
 *
 * Sequence:
 *   A. True model - migrate existing chunks (001 -> 002) via full re-embed
 *   B. Modify README.md -> re-analyze -> re-embed (partial: only README re-embeds)
 *   C. Restore README.md -> re-analyze -> re-embed (all skip, 0 Gemini calls)
 */
require("dotenv").config({ path: __dirname + "/.env" });
const jwt  = require("jsonwebtoken");
const mongoose = require("mongoose");

const BASE      = "http://localhost:5000";
const JWT_SEC   = process.env.JWT_SECRET;
const REPO_ID   = "6aa271a174eca91f333d2d9b";
const README    = "README.md";

async function auth() {
  const User = require("./models/User");
  const user = await User.findOne({ username: "truptijadhav33" }).lean();
  const token = jwt.sign({ sub: String(user._id), githubAccessToken: "dummy" }, JWT_SEC, { expiresIn: "1h" });
  return `token=${token}; Path=/`;
}

function call(method, path, cookie, body) {
  const opts = { method, headers: { Cookie: cookie, "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  return fetch(`${BASE}${path}`, opts).then(async r => {
    const t = await r.text();
    return { status: r.status, body: t ? JSON.parse(t) : null };
  });
}

async function main() {
  if (!JWT_SEC) throw new Error("No JWT_SECRET");
  await mongoose.connect(process.env.MONGODB_URI);
  const RepoFile   = require("./models/RepositoryFile");
  const Chunk      = require("./models/Chunk");
  const FileAnalysis = require("./models/FileAnalysis");
  const { hashContent } = require("./services/embeddings");
  const cookie = await auth();

  const readmeDoc = await RepoFile.findOne({ repositoryId: REPO_ID, path: README }).lean();
  const origContent = readmeDoc.content;

  // ---- A. Full re-embed: migration 001->002 (all chunks get embeddingModel stamped) ----
  console.log("\n=== A. Full re-embed (model migration to gemini-embedding-2) ===");
  let { status: sA, body: bA } = await call("POST", `/api/repos/${REPO_ID}/embed?force=true`, cookie);
  console.log(`  status: ${sA}`);
  if (sA === 201) {
    console.log(`  chunksCreated: ${bA.chunksCreated}  skipped: ${bA.chunksSkipped}  embedded: ${bA.chunksEmbedded}`);
    console.log(`  model: ${bA.model}`);
  } else {
    console.log(`  error: ${bA?.error || "unknown"}`);
    console.log("  (if 429: server still on old model — restart it manually)");
  }

  // ---- B. Partial embed: modify README, re-analyze, re-embed ----
  console.log("\n=== B. Partial embed (modify README.md) ===");
  const modified = origContent + "\n<!-- CodeLens partial-embed verification " + Date.now() + " -->\n";
  await RepoFile.updateOne({ repositoryId: REPO_ID, path: README }, { $set: { content: modified } });
  await call("POST", `/api/repos/${REPO_ID}/analyze`, cookie, { force: true });

  let { status: sB, body: bB } = await call("POST", `/api/repos/${REPO_ID}/embed?force=true`, cookie);
  console.log(`  status: ${sB}`);
  if (sB === 201) {
    console.log(`  chunksCreated: ${bB.chunksCreated}  skipped: ${bB.chunksSkipped}  embedded: ${bB.chunksEmbedded}`);
    const bOK = bB.chunksEmbedded >= 1 && bB.chunksSkipped > 0 && (bB.chunksEmbedded + bB.chunksSkipped) === bB.chunksCreated;
    console.log(`  PASS partial-embed: ${bOK}`);
  } else {
    console.log(`  error: ${bB?.error || "unknown"}`);
  }

  // Verify README chunks now stamped with new hash + embedding + model
  const mdChunks = await Chunk.find({ repositoryId: REPO_ID, path: README }).lean();
  const mdHash = hashContent(modified);
  const mdOK = mdChunks.length > 0 && mdChunks.every(c =>
    c.contentHash === mdHash && Array.isArray(c.embedding) && c.embedding.length === 768 && c.embeddingModel === "gemini-embedding-2"
  );
  console.log(`  README chunks: ${mdChunks.length}, contentHash+embedding+model: ${mdOK}`);

  // Also verify an unchanged file kept its embedding and same model
  const otherPath = "frontend/src/App.jsx";
  const otherChunks = await Chunk.find({ repositoryId: REPO_ID, path: otherPath }).lean();
  const otherOK = otherChunks.every(c => c.embeddingModel === "gemini-embedding-2" && Array.isArray(c.embedding) && c.embedding.length === 768);
  console.log(`  ${otherPath}: ${otherChunks.length} chunks, model+embedding: ${otherOK}`);

  // ---- C. Restore + re-embed: everything skips ----
  console.log("\n=== C. Restore README.md + re-embed (all skip) ===");
  await RepoFile.updateOne({ repositoryId: REPO_ID, path: README }, { $set: { content: origContent } });
  await call("POST", `/api/repos/${REPO_ID}/analyze`, cookie, { force: true });
  let { status: sC, body: bC } = await call("POST", `/api/repos/${REPO_ID}/embed?force=true`, cookie);
  console.log(`  status: ${sC}`);
  if (sC === 201) {
    console.log(`  chunksCreated: ${bC.chunksCreated}  skipped: ${bC.chunksSkipped}  embedded: ${bC.chunksEmbedded}`);
    const cOK = bC.chunksEmbedded === 0 && bC.chunksSkipped === bC.chunksCreated;
    console.log(`  PASS all-skip: ${cOK}`);
  } else {
    console.log(`  error: ${bC?.error || "unknown"}`);
  }

  // Final DB state check
  const finalCount = await Chunk.countDocuments({ repositoryId: REPO_ID });
  const allModelOK = (await Chunk.distinct("embeddingModel", { repositoryId: REPO_ID }));
  const allHashOK = (await Chunk.countDocuments({ repositoryId: REPO_ID, contentHash: null }));
  console.log(`\nFinal: ${finalCount} chunks, models=${allModelOK.join(",")}, chunks w/o contentHash: ${allHashOK}`);

  await mongoose.disconnect();
  console.log("\nDone.");
}

main().catch(e => { console.error(e); process.exit(1); });