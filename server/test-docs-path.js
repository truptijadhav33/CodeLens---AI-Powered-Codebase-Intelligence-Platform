/**
 * Phase 7 E2E verification — Documentation Generation.
 *
 * 1. GET  /docs         — expect all sections null
 * 2. POST /docs/generate (all 6) — expect 6 generated + Gemini call count captured
 * 3. GET  /docs         — confirm all sections now have content
 * 4. POST /docs/generate (all 6) — expect 6 cached + ZERO new Gemini calls
 * 5. POST /docs/:type/regenerate — expect regenerated section + 1 more Gemini call
 */
require("dotenv").config({ path: __dirname + "/.env" });
const fs = require("fs");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

const REPO_ID = "6aa271a174eca91f333d2d9b";
const LOG_PATH = __dirname + "/server.out.log";

function signToken(userId) {
  return jwt.sign({ sub: String(userId) }, process.env.JWT_SECRET, { expiresIn: "1h" });
}

function countGeminiCalls() {
  try {
    const text = fs.readFileSync(LOG_PATH, "utf8");
    return (text.match(/\[ask\] trying (primary|fallback) model/g) || []).length;
  } catch {
    return -1;
  }
}

async function fetchJson(method, path, body, headers) {
  const res = await fetch(path, {
    method,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const User = require("./models/User");
  const user = await User.findOne({ username: "truptijadhav33" }).lean();
  if (!user) throw new Error("User truptijadhav33 not found");
  const token = signToken(user._id);
  const BASE = `http://localhost:5000/api/repos/${REPO_ID}`;
  const cookie = `token=${token}`;
  const headers = { Cookie: cookie, "Content-Type": "application/json" };

  let passed = 0;
  let failed = 0;
  function assert(label, ok, detail) {
    if (ok) {
      passed++;
      console.log(`  PASS  ${label}${detail ? "  " + detail : ""}`);
    } else {
      failed++;
      console.error(`  FAIL  ${label}${detail ? "  " + detail : ""}`);
    }
  }

  // ── 1. GET /docs (before generation) ──────────────────────────────────
  console.log("\n1. GET /docs (expect all null)");
  {
    const data = await fetchJson("GET", `${BASE}/docs`, null, headers);
    assert("status 200", true);
    assert("6 sections returned", data.sections.length === 6, `got ${data.sections.length}`);
    const allNull = data.sections.every((s) => s.content === null);
    assert("all content null", allNull, JSON.stringify(data.sections.map((s) => [s.sectionType, !!s.content])));
    data.sections.forEach((s) => assert(`sourceFiles empty for ${s.sectionType}`, (s.sourceFiles || []).length === 0));
  }

  // ── 2. POST /docs/generate (all 6) ────────────────────────────────────
  console.log("\n2. POST /docs/generate (expect 6 generated)");
  const callsBefore1 = countGeminiCalls();
  console.log(`   Gemini calls before generate: ${callsBefore1}`);
  let gen1;
  {
    gen1 = await fetchJson("POST", `${BASE}/docs/generate`, {}, headers);
    assert("status 200", true);
    assert("6 sections returned", gen1.sections.length === 6, `got ${gen1.sections.length}`);
    assert("generated ≥ 6", gen1.generated.length >= 6,
      `generated=${JSON.stringify(gen1.generated)}, errors=${JSON.stringify(gen1.errors || [])}`);
    assert("cached count", gen1.cached.length === 0, `cached=${JSON.stringify(gen1.cached)}`);
    gen1.sections.forEach((s) => assert(`content not null: ${s.sectionType}`, !!s.content, `len=${(s.content || "").length}`));
    gen1.sections.forEach((s) => assert(`sourceFiles present: ${s.sectionType}`, (s.sourceFiles || []).length > 0,
      `files=${s.sourceFiles.length}: ${s.sourceFiles.slice(0, 3).join(", ")}`));
  }
  const callsAfter1 = countGeminiCalls();
  console.log(`   Gemini calls after generate: ${callsAfter1}`);
  assert("Gemini calls increased", callsAfter1 > callsBefore1,
    `+${callsAfter1 - callsBefore1} calls`);

  // ── 3. GET /docs (after generation) ────────────────────────────────────
  console.log("\n3. GET /docs (confirm persisted)");
  {
    const data = await fetchJson("GET", `${BASE}/docs`, null, headers);
    assert("all content present", data.sections.every((s) => s.content !== null && s.content.length > 0));
    data.sections.forEach((s) => assert(`generatedAt set: ${s.sectionType}`, !!s.generatedAt));
  }

  // ── 4. POST /docs/generate again (expect cached, zero new Gemini calls) ─
  console.log("\n4. POST /docs/generate (expect 6 cached, 0 new Gemini calls)");
  const callsBefore2 = countGeminiCalls();
  {
    const gen2 = await fetchJson("POST", `${BASE}/docs/generate`, {}, headers);
    assert("6 cached", gen2.cached.length === 6, `cached=${JSON.stringify(gen2.cached)}`);
    assert("0 generated", gen2.generated.length === 0, `generated=${JSON.stringify(gen2.generated)}`);
  }
  const callsAfter2 = countGeminiCalls();
  console.log(`   Gemini calls after cached run: ${callsAfter2} (before was ${callsBefore2})`);
  assert("zero new Gemini calls", callsAfter2 === callsBefore2,
    `delta=${callsAfter2 - callsBefore2}`);

  // ── 5. POST /docs/overview/regenerate (force-regenerate 1 section) ──────
  console.log("\n5. POST /docs/overview/regenerate (expect 1 new Gemini call)");
  const callsBefore3 = countGeminiCalls();
  {
    const regen = await fetchJson("POST", `${BASE}/docs/overview/regenerate`, {}, headers);
    assert("regen status 200", true);
    assert("overview.content present", !!regen.section?.content, `len=${(regen.section?.content || "").length}`);
    assert("overview.sourceFiles present", (regen.section?.sourceFiles || []).length > 0);
  }
  const callsAfter3 = countGeminiCalls();
  console.log(`   Gemini calls after regenerate: ${callsAfter3}`);
  assert("+1 Gemini call", callsAfter3 === callsBefore3 + 1,
    `delta=${callsAfter3 - callsBefore3}`);

  // ── Summary ────────────────────────────────────────────────────────────
  console.log(`\n${"=".repeat(50)}`);
  console.log(`RESULTS: ${passed} passed, ${failed} failed`);

  // Print brief overview of each section for sanity
  {
    const data = await fetchJson("GET", `${BASE}/docs`, null, headers);
    console.log("\nSection summaries:");
    for (const s of data.sections) {
      const preview = (s.content || "").slice(0, 200).replace(/\n/g, " ");
      console.log(`  [${s.sectionType}] len=${(s.content || "").length}, files=${(s.sourceFiles || []).length} — ${preview}…`);
    }
  }

  await mongoose.disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
