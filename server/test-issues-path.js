/**
 * End-to-end verification of Phase 6 (Technical Debt & Issue Detection):
 *   A. POST /:id/detect-issues -> issues persisted, counts returned
 *   B. GET  /:id/issues        -> paginated, high-severity first
 *   C. Filter by type + severity
 *   D. POST /:id/issues/:id/explain -> first call calls Gemini, persists
 *   E. Same explain again -> cached:true, stored text returned (NO Gemini re-call)
 */
require("dotenv").config({ path: __dirname + "/.env" });
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

const BASE = "http://localhost:5000";
const JWT_SEC = process.env.JWT_SECRET;
const REPO_ID = "6aa271a174eca91f333d2d9b";

async function auth() {
  const User = require("./models/User");
  const user = await User.findOne({ username: "truptijadhav33" }).lean();
  const token = jwt.sign({ sub: String(user._id), githubAccessToken: "dummy" }, JWT_SEC, { expiresIn: "1h" });
  return `token=${token}; Path=/`;
}

function call(method, path, cookie, body) {
  const opts = { method, headers: { Cookie: cookie, "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  return fetch(`${BASE}${path}`, opts).then(async (r) => {
    const t = await r.text();
    return { status: r.status, body: t ? JSON.parse(t) : null };
  });
}

async function main() {
  if (!JWT_SEC) throw new Error("No JWT_SECRET");
  await mongoose.connect(process.env.MONGODB_URI);
  const Issue = require("./models/Issue");
  const cookie = await auth();

  // ---- A. Detect issues ----
  console.log("=== A. Detect issues ===");
  const { status: sA, body: bA } = await call("POST", `/api/repos/${REPO_ID}/detect-issues`, cookie);
  console.log(`  status: ${sA}`);
  if (sA === 201) {
    console.log(`  total: ${bA.total}`);
    console.log(`  byType: ${JSON.stringify(bA.byType)}`);
    console.log(`  bySeverity: ${JSON.stringify(bA.bySeverity)}`);
    const persisted = await Issue.countDocuments({ repositoryId: REPO_ID });
    console.log(`  persisted in DB: ${persisted}`);
    console.log(`  PASS detect: ${bA.total === persisted}`);
  } else {
    console.log(`  error: ${bA?.error || "unknown"}`);
    return;
  }

  // ---- B. List (paginated) ----
  console.log("\n=== B. List issues (limit 5) ===");
  const { status: sB, body: bB } = await call("GET", `/api/repos/${REPO_ID}/issues?limit=5`, cookie);
  console.log(`  status: ${sB}`);
  if (sB === 200) {
    console.log(`  total: ${bB.total}, page: ${bB.page}, returned: ${bB.issues.length}`);
    console.log(`  first severities: ${bB.issues.map(i => i.severity).join(",")}`);
    const sortedOK = bB.issues.every((i, idx, arr) => arr[idx + 1] ? (["high", "medium", "low"].indexOf(i.severity) <= ["high", "medium", "low"].indexOf(arr[idx + 1].severity)) : true);
    console.log(`  PASS sorted high-first: ${sortedOK}`);
    console.log(`  sample: ${bB.issues[0]?.type}/${bB.issues[0]?.severity} ${(bB.issues[0]?.message || "").slice(0, 70)}`);
  }

  // ---- C. Filtering ----
  console.log("\n=== C. Filter by type=duplication, severity=low ===");
  const c1 = await call("GET", `/api/repos/${REPO_ID}/issues?type=duplication&limit=100`, cookie);
  console.log(`  type=duplication total: ${c1.body.total}, types: ${[...new Set(c1.body.issues.map(i => i.type))].join(",")}`);
  const c2 = await call("GET", `/api/repos/${REPO_ID}/issues?severity=low&limit=100`, cookie);
  console.log(`  severity=low total: ${c2.body.total}, severities: ${[...new Set(c2.body.issues.map(i => i.severity))].join(",")}`);
  console.log(`  PASS filters: ${c1.body.total === 2 && c1.body.issues.every(i => i.type === "duplication") && c2.body.issues.every(i => i.severity === "low")}`);

  // ---- D. Explain once (calls Gemini) ----
  console.log("\n=== D. Explain with AI (first call) ===");
  const target = c1.body.issues[0]; // a duplication issue
  console.log(`  target issue: ${target.type} ${target.filePath}`);
  const d = await call("POST", `/api/repos/${REPO_ID}/issues/${target.id}/explain`, cookie);
  console.log(`  status: ${d.status}`);
  if (d.status === 200) {
    console.log(`  cached: ${d.body.cached}`);
    console.log(`  explanation: ${(d.body.aiExplanation || "").slice(0, 120)}...`);
    console.log(`  suggestion: ${(d.body.aiSuggestion || "").slice(0, 120)}...`);
    const fromDB = await Issue.findById(target.id).lean();
    console.log(`  persisted in Atlas: ${Boolean(fromDB.aiExplanation)} (len ${(fromDB.aiExplanation || "").length})`);
    console.log(`  PASS explain-once: ${Boolean(d.body.aiExplanation) && Boolean(fromDB.aiExplanation)}`);
  } else {
    console.log(`  error: ${d.body?.error || "unknown"}`);
  }

  // ---- E. Explain again (must be cached, no Gemini) ----
  console.log("\n=== E. Explain again (cached) ===");
  const e = await call("POST", `/api/repos/${REPO_ID}/issues/${target.id}/explain`, cookie);
  console.log(`  status: ${e.status}, cached: ${e.body?.cached}`);
  const cached = e.status === 200 && e.body?.cached === true;
  console.log(`  explanation unchanged: ${e.body?.aiExplanation === d.body?.aiExplanation}`);
  console.log(`  PASS cached: ${cached}`);

  await mongoose.disconnect();
  console.log("\nDone.");
}

main().catch((e) => { console.error(e); process.exit(1); });