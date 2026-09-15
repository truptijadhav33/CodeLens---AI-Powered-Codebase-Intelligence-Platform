const crypto = require("crypto");
const Chunk = require("../models/Chunk");

const GEMINI_EMBED_MODEL = process.env.GEMINI_EMBED_MODEL || "gemini-embedding-2";
const EMBEDDING_DIMENSION = 768;
// Per the free-tier quota profile observed on this account, each item inside a
// batchEmbedContents batch counts against the per-minute cap (100 items/min).
// Keeping BATCH_SIZE at half that limit (50) guarantees headroom even under
// concurrent usage, so a single batch can never trip the throttle.
const BATCH_SIZE = 50;
const MAX_TRANSIENT_RETRIES = 2;
const MAX_TRANSIENT_WAIT_MS = 60 * 1000;

const DAILY_QUOTA_MESSAGE =
  "Daily embedding quota reached. This resets at midnight Pacific Time — try again later.";

class DailyQuotaError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = "DailyQuotaError";
    this.status = 429;
    this.isRetryable = false;
    this.detail = detail;
  }
}

// The daily vs per-minute 429s have nearly identical top-level messages, so the
// discriminator is the quotaId inside error.details: a quotaId containing
// "PerDay" means the free-tier daily cap is exhausted and will not reset until
// midnight Pacific, so retry is useless. Anything else (PerMinute, etc.) is
// transient and can resolve with a short backoff.
function getQuotaIds(errMessage) {
  const ids = [];
  try {
    const body = JSON.parse(errMessage);
    for (const d of body?.error?.details || []) {
      // quotaId can be a top-level detail key, or nested under each violation
      // (QuotaFailure => violations[].quotaId). Both carry the same metric.
      if (d?.quotaId) ids.push(d.quotaId);
      for (const v of d?.violations || []) {
        if (v?.quotaId) ids.push(v.quotaId);
      }
    }
  } catch {}
  return ids;
}

function isDailyQuota(errMessage) {
  return getQuotaIds(errMessage).some((id) => /PerDay/i.test(id));
}

function isTransient(errMessage) {
  // Per-minute quotaId always present on 429; 503/UNAVAILABLE also transient.
  return (
    getQuotaIds(errMessage).some((id) => /PerMinute/i.test(id)) ||
    /\b503\b|UNAVAILABLE/.test(errMessage)
  );
}

class BatchFailureError extends Error {
  constructor(message, transient) {
    super(message);
    this.name = "BatchFailureError";
    this.isTransient = transient;
  }
}

function getApiKey() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not configured");
  return key;
}

function hashContent(text) {
  return crypto.createHash("sha1").update(text).digest("hex");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseRetryDelay(errMessage, fallbackMs = 30000) {
  try {
    const m = errMessage.match(/retryDelay["']?\s*:\s*["']?(\d+)s/);
    if (m) return parseInt(m[1], 10) * 1000 + 1000;
    const m2 = errMessage.match(/Please retry in ([\d.]+)s/);
    if (m2) return Math.ceil(parseFloat(m2[1]) * 1000) + 1000;
  } catch {}
  return fallbackMs;
}

async function embedBatch(texts, taskType = "RETRIEVAL_DOCUMENT") {
  const apiKey = getApiKey();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_EMBED_MODEL}:batchEmbedContents`;
  const body = {
    requests: texts.map((text) => ({
      model: `models/${GEMINI_EMBED_MODEL}`,
      content: { parts: [{ text }] },
      taskType,
      outputDimensionality: EMBEDDING_DIMENSION,
    })),
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    if (isDailyQuota(errText)) {
      throw new DailyQuotaError(DAILY_QUOTA_MESSAGE, errText);
    }
    // Raw JSON text so getQuotaIds can parse quotaId for classification.
    throw new Error(errText);
  }

  const data = await res.json();
  const embeddings = data.embeddings || [];
  if (embeddings.length !== texts.length) {
    throw new Error(`Expected ${texts.length} embeddings, got ${embeddings.length}`);
  }
  return embeddings.map((e) => e.values);
}

async function embedSingle(text, taskType = "RETRIEVAL_DOCUMENT") {
  const apiKey = getApiKey();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_EMBED_MODEL}:embedContent`;
  const body = {
    model: `models/${GEMINI_EMBED_MODEL}`,
    content: { parts: [{ text }] },
    taskType,
    outputDimensionality: EMBEDDING_DIMENSION,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    if (isDailyQuota(errText)) {
      throw new DailyQuotaError(DAILY_QUOTA_MESSAGE, errText);
    }
    throw new Error(errText);
  }

  const data = await res.json();
  return data.embedding.values;
}

// Retry ONLY transient per-minute limits (429) and 503 overload. Daily-quota
// exhaustion fails immediately — no backoff can change a quota that resets at
// midnight Pacific.
async function embedBatchWithRetry(batch, taskType) {
  for (let attempt = 0; attempt <= MAX_TRANSIENT_RETRIES; attempt++) {
    try {
      return await embedBatch(batch, taskType);
    } catch (err) {
      if (err instanceof DailyQuotaError) throw err;
      const msg = err.message || "";
      if (isTransient(msg) && attempt < MAX_TRANSIENT_RETRIES) {
        // Per-minute caps reset every 60s; use the server's suggested delay as a
        // floor but always wait long enough to clear the minute window.
        const waitMs = Math.max(parseRetryDelay(msg), MAX_TRANSIENT_WAIT_MS);
        console.warn(
          `[embed] transient ${/503/.test(msg) ? "503" : "429"} (batch attempt ${attempt + 1}/${MAX_TRANSIENT_RETRIES + 1}), retrying in ${waitMs}ms`
        );
        await sleep(waitMs + Math.random() * 1000);
        continue;
      }
      throw new BatchFailureError(msg, isTransient(msg));
    }
  }
}

async function embedTexts(texts, taskType = "RETRIEVAL_DOCUMENT") {
  if (texts.length === 0) return [];
  const all = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    try {
      const embeddings = await embedBatchWithRetry(batch, taskType);
      all.push(...embeddings);
    } catch (err) {
      if (err instanceof DailyQuotaError) throw err;
      if (err instanceof BatchFailureError && err.isTransient) {
        throw new Error(
          `Gemini embedding was repeatedly rate limited (429/503) — try again in a few minutes. ${err.message.slice(0, 120)}`
        );
      }
      // Non-transient batch failure (e.g. one malformed item) → retry each item alone.
      // NEVER used for 429/RESOURCE_EXHAUSTED — that would multiply traffic against an
      // already-capped quota.
      console.warn(`[embed] batchEmbedContents failed (${err.message}); falling back to single embedContent calls`);
      for (const text of batch) {
        all.push(await embedSingle(text, taskType));
      }
    }
    // Brief pause between batches to stay under the per-minute item cap.
    if (i + BATCH_SIZE < texts.length) await sleep(800);
  }
  return all;
}

// Embed a repo's chunks, skipping any whose (path, chunkIndex) already has a stored
// embedding with matching content. Returns the full rebuilt chunk list plus counts.
async function embedChunks(chunkInputs, taskType = "RETRIEVAL_DOCUMENT") {
  if (!chunkInputs || chunkInputs.length === 0) {
    return { chunks: [], skipped: 0, embedded: 0 };
  }

  const repositoryId = chunkInputs[0].repositoryId;
  const existing = await Chunk.find({ repositoryId, embedding: { $ne: null } })
    .select("path chunkIndex content embedding contentHash embeddingModel")
    .lean();

  const existingMap = new Map();
  for (const doc of existing) {
    if (Array.isArray(doc.embedding) && doc.embedding.length > 0) {
      existingMap.set(`${doc.path}\u0000${doc.chunkIndex}`, doc);
    }
  }

  const resultChunks = [];
  const toEmbed = [];
  let skipped = 0;

  for (const c of chunkInputs) {
    const ex = existingMap.get(`${c.path}\u0000${c.chunkIndex}`);
    const cHash = c.contentHash || hashContent(c.content);
    const sameModel = ex && ex.embeddingModel === GEMINI_EMBED_MODEL;
    const reuse =
      ex &&
      sameModel &&
      ((ex.contentHash && ex.contentHash === cHash) || (!ex.contentHash && ex.content === c.content));
    if (reuse) {
      resultChunks.push({ ...c, contentHash: cHash, embeddingModel: GEMINI_EMBED_MODEL, embedding: ex.embedding });
      skipped++;
    } else {
      toEmbed.push({ ...c, contentHash: cHash, embeddingModel: GEMINI_EMBED_MODEL });
    }
  }

  let embedded = 0;
  if (toEmbed.length > 0) {
    const embeddings = await embedTexts(toEmbed.map((c) => c.content), taskType);
    for (let i = 0; i < toEmbed.length; i++) {
      toEmbed[i].embedding = embeddings[i];
    }
    resultChunks.push(...toEmbed);
    embedded = toEmbed.length;
  }

  return { chunks: resultChunks, skipped, embedded };
}

module.exports = {
  GEMINI_EMBED_MODEL,
  EMBEDDING_DIMENSION,
  BATCH_SIZE,
  DailyQuotaError,
  DAILY_QUOTA_MESSAGE,
  hashContent,
  embedTexts,
  embedSingle,
  embedBatch,
  embedChunks,
};