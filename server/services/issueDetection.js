const path = require("path");
const FileAnalysis = require("../models/FileAnalysis");
const RepositoryFile = require("../models/RepositoryFile");
const { buildDependencyGraph } = require("./dependencyGraph");

// Configurable via env; matches the pattern used for MAX_REPO_FILES etc.
const COMPLEXITY_THRESHOLD = parseInt(process.env.COMPLEXITY_THRESHOLD || "10", 10);
const HIGH_COMPLEXITY_BAR = parseInt(process.env.HIGH_COMPLEXITY_BAR || "20", 10);

const SRC_RE = /\.(js|jsx|ts|tsx)$/i;
const TEST_FILE_RE = /\.(test|spec)\.(js|jsx|ts|tsx)$/i;

// ---------------------------------------------------------------------------
// Detectors below are 100% deterministic (no AI). They derive issues from data
// that already exists in Mongo (FileAnalysis + dependency graph + file list) —
// nothing is re-parsed.
// ---------------------------------------------------------------------------

// ---- (c) missing-test —-----------------------------------------------------
// A naming heuristic, NOT real coverage data: suggests plausible test paths for
// a source file and checks whether any of them exist in the repo file list.
function testCandidatesFor(sourcePath) {
  const dir = path.posix.dirname(sourcePath);
  const base = path.posix.basename(sourcePath);
  const ext = path.posix.extname(base);
  const stem = base.slice(0, -ext.length);
  const stemExt = ext.slice(1);
  // Check the source file's own extension plus .js (TS files can have JS tests).
  const exts = new Set([stemExt, "js"]);

  const candidates = [];
  for (const e of exts) {
    candidates.push(`${dir}/${stem}.test.${e}`);
    candidates.push(`${dir}/${stem}.spec.${e}`);
    candidates.push(`${dir}/__tests__/${stem}.test.${e}`);
    candidates.push(`${dir}/__tests__/${stem}.spec.${e}`);
    candidates.push(`${dir}/__tests__/${base}`);
  }
  return candidates;
}

// ---- (e) duplication —-------------------------------------------------------
// A cheap signal, explicitly NOT clone/AST-diff detection. We approximate a
// function's body size from its stored start line and the next stored symbol's
// start line (FileAnalysis.functions[].line / classes[].line). Two same-named
// functions in different files with very similar estimated sizes are flagged as
// "possible duplicate logic, worth a manual look." False positives are expected.
function estimateFunctionLines(fn, symbolsSorted, linesOfCode) {
  const next = symbolsSorted.find((s) => s.line > fn.line);
  if (next) {
    // Approximate the body as the span to the next symbol's declaration line.
    return Math.max(next.line - fn.line, 1);
  }
  // Last symbol in the file: estimate from the file's line count.
  return Math.max((linesOfCode || 0) - fn.line + 1, 1);
}

function sizeDiffIsClose(a, b) {
  const diff = Math.abs(a - b);
  const max = Math.max(a, b);
  return diff <= 3 || (max > 0 && diff / max <= 0.25);
}

// ---- Main entry -------------------------------------------------------------
async function detectIssues(repositoryId) {
  const [analyses, repoFiles, graph] = await Promise.all([
    FileAnalysis.find({ repositoryId }).lean(),
    RepositoryFile.find({ repositoryId }).select({ path: 1 }).lean(),
    buildDependencyGraph(repositoryId),
  ]);

  const filePathSet = new Set(repoFiles.map((f) => f.path));
  const issues = [];

  // ---- (a) lint issues — surface stored lint findings as individual issues.
  for (const a of analyses) {
    for (const li of a.lintIssues || []) {
      issues.push({
        type: "lint",
        severity: li.severity === "error" ? "high" : "medium",
        filePath: a.path,
        relatedFilePath: null,
        message: `[${li.ruleId || "parse-error"}] ${li.message}`,
        detail: {
          ruleId: li.ruleId || "parse-error",
          line: li.line || 0,
          column: li.column || 0,
          originalSeverity: li.severity,
        },
      });
    }
  }

  // ---- (b) high complexity — per-file issues for files with functions that
  // exceed the threshold, or whose aggregate complexity exceeds the file bar.
  for (const a of analyses) {
    const overThreshold = (a.functions || []).filter((f) => f.complexity > COMPLEXITY_THRESHOLD);
    if (overThreshold.length === 0) continue;
    issues.push({
      type: "complexity",
      severity: a.complexityScore > HIGH_COMPLEXITY_BAR ? "high" : "medium",
      filePath: a.path,
      relatedFilePath: null,
      message: `High complexity in ${a.path}: ${overThreshold.length} function(s) exceed the complexity threshold of ${COMPLEXITY_THRESHOLD}.`,
      detail: {
        complexityScore: a.complexityScore || 0,
        threshold: COMPLEXITY_THRESHOLD,
        issueLine: overThreshold[0].line || 0,
        functions: overThreshold.map((f) => ({ name: f.name, line: f.line, complexity: f.complexity })),
      },
    });
  }

  // ---- (c) missing tests — naming heuristic, no coverage data involved.
  for (const a of analyses) {
    if (TEST_FILE_RE.test(a.path)) continue; // a test file itself
    if (a.path.includes("__tests__")) continue;
    if (SRC_RE.test(a.path)) {
      const candidates = testCandidatesFor(a.path);
      const hasTest = candidates.some((c) => filePathSet.has(c));
      if (!hasTest) {
        issues.push({
          type: "missing-test",
          severity: "low",
          filePath: a.path,
          relatedFilePath: null,
          message: `No test file found for ${a.path}.`,
          detail: {
            heuristic: "Name-based heuristic only — checked for <name>.test.js / <name>.spec.js / __tests__/ variants. This is NOT real coverage data.",
            checked: candidates,
          },
        });
      }
    }
  }

  // ---- (d) dependency concerns — high in-degree = high blast radius.
  const internalWithEdges = (graph.nodes || []).filter((n) => n.type === "internal" && n.inDegree > 0);
  const sortedDegrees = internalWithEdges.map((n) => n.inDegree).sort((x, y) => y - x);
  if (sortedDegrees.length >= 10) {
    // Top ~10% cutoff: the in-degree at the 90th percentile mark larger values.
    const cutoffIndex = Math.max(0, Math.floor(sortedDegrees.length * 0.9) - 1);
    const threshold = sortedDegrees[cutoffIndex];
    for (const n of internalWithEdges) {
      if (n.inDegree >= threshold && n.inDegree >= 2) {
        issues.push({
          type: "dependency",
          severity: "medium",
          filePath: n.path,
          relatedFilePath: null,
          message: `High-impact file: ${n.inDegree} other file(s) import ${n.path} directly — changes here could affect many files.`,
          detail: {
            inDegree: n.inDegree,
            threshold,
            internalFilesWithEdges: sortedDegrees.length,
            internalFiles: graph.stats.internalFiles,
            note: "Risk signal derived from dependency-graph in-degree (top ~10%), not necessarily a defect.",
          },
        });
      }
    }
  }

  // ---- (e) approximate duplication — same name + very similar estimated size.
  const fnIndex = new Map(); // name -> [{ path, line, complexity, estimatedLines }]
  for (const a of analyses) {
    if (!(a.functions || []).length) continue;
    const linesOfCode = a.linesOfCode || 0;
    const funcs = [...a.functions].sort((x, y) => x.line - y.line);
    const symbols = [
      ...funcs.map((f) => ({ line: f.line })),
      ...(a.classes || []).map((c) => ({ line: c.line })),
    ].sort((x, y) => x.line - y.line);

    for (const fn of funcs) {
      const estimatedLines = estimateFunctionLines(fn, symbols, linesOfCode);
      if (!fnIndex.has(fn.name)) fnIndex.set(fn.name, []);
      fnIndex.get(fn.name).push({
        path: a.path,
        line: fn.line,
        complexity: fn.complexity,
        estimatedLines,
      });
    }
  }

  for (const [name, entries] of fnIndex) {
    const distinctFiles = new Set(entries.map((e) => e.path));
    // Same-named function in only one file is not a cross-file duplicate signal.
    if (distinctFiles.size < 2) continue;
    // A name used across many files is likely a generic helper/boilerplate, not
    // a duplicate worth listing — keep the signal cheap and high-precision-ish.
    if (distinctFiles.size > 8) continue;

    const ordered = entries
      .slice()
      .sort((x, y) => (x.path === y.path ? x.line - y.line : x.path.localeCompare(y.path)));
    let emitted = 0;
    for (let i = 0; i < ordered.length && emitted < 5; i++) {
      for (let j = i + 1; j < ordered.length && emitted < 5; j++) {
        const aItem = ordered[i];
        const bItem = ordered[j];
        if (aItem.path === bItem.path) continue;
        if (!sizeDiffIsClose(aItem.estimatedLines, bItem.estimatedLines)) continue;
        issues.push({
          type: "duplication",
          severity: "low",
          filePath: aItem.path,
          relatedFilePath: bItem.path,
          message: `Possible duplicate logic: function "${name}" in ${aItem.path} and ${bItem.path} has a very similar estimated size (~${aItem.estimatedLines} vs ~${bItem.estimatedLines} lines). Worth a manual look.`,
          detail: {
            functionName: name,
            lineA: aItem.line,
            lineB: bItem.line,
            estimatedLinesA: aItem.estimatedLines,
            estimatedLinesB: bItem.estimatedLines,
            complexityA: aItem.complexity,
            complexityB: bItem.complexity,
            note: "Naming + size heuristic only, NOT real clone/AST detection — false positives are expected.",
          },
        });
        emitted++;
      }
    }
  }

  return { issues };
}

module.exports = {
  detectIssues,
  testCandidatesFor,
  estimateFunctionLines,
  COMPLEXITY_THRESHOLD,
  HIGH_COMPLEXITY_BAR,
  SRC_RE,
  TEST_FILE_RE,
};