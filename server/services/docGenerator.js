const path = require("path");
const FileAnalysis = require("../models/FileAnalysis");
const RepositoryFile = require("../models/RepositoryFile");
const { buildDependencyGraph } = require("./dependencyGraph");
const { generateText } = require("./gemini");
const { retrieveRelevantChunks } = require("./retrieval");
const { SRC_RE, TEST_FILE_RE } = require("./issueDetection");

const SECTION_TYPES = ["overview", "architecture", "api", "modules", "setup", "contributing"];
const RETRIEVAL_QUERY = "what does this project do and how is it structured";
const STRONG_API_PATH_RE = /(^|\/)(route|routes|controller|controllers|api|endpoint)([.]|$|\/)/i;
const SERVER_FILES_RE = /(^|\/)server([.]|$|\/)|(^|\/)server\.(js|jsx|ts|tsx)$/i;
const API_EXPORT_RE = /^(router|app|handler|handlers|controller|routes|api)$/i;
const API_PREFIX_RE = /^(get|post|put|patch|delete|head|options)/i;
const TEST_PATH_RE = /(__tests__|\/tests\/|\.(test|spec)\.(js|jsx|ts|tsx)$)/i;
const ENV_EXAMPLE_RE = /\.env[._](example|sample|template)/i;
const LINT_CONFIG_RE = /(eslint|prettier)/i;

function boundedLines(text, maxLines) {
  if (!text) return "";
  const lines = text.split("\n");
  if (lines.length <= maxLines) return text;
  return lines.slice(0, maxLines).join("\n") + `\n... (${lines.length - maxLines} lines truncated)`;
}

function countLanguages(analyses) {
  const counts = {};
  for (const a of analyses) {
    const lang = a.language || "unknown";
    counts[lang] = (counts[lang] || 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([lang, count]) => `${lang}: ${count} file(s)`)
    .join(", ");
}

function topLevelDirs(files) {
  const dirs = {};
  for (const f of files) {
    const parts = f.path.split("/");
    const dir = parts.length > 1 ? parts[0] : "(root)";
    dirs[dir] = (dirs[dir] || 0) + 1;
  }
  return Object.entries(dirs)
    .sort((a, b) => b[1] - a[1])
    .map(([dir, count]) => `${dir}/ (${count} files)`)
    .join("\n");
}

async function retrieveContext(repositoryId) {
  try {
    const Chunk = require("../models/Chunk");
    const count = await Chunk.countDocuments({ repositoryId });
    if (count === 0) return { chunks: [], paths: [] };
    const { chunks } = await retrieveRelevantChunks(repositoryId, RETRIEVAL_QUERY);
    const top = (chunks || []).slice(0, 6);
    const paths = [...new Set(top.map((c) => c.path))];
    const formatted = top
      .map((c, i) => `---\n[Chunk ${i + 1} | File: ${c.path}]\n${c.content}\n---`)
      .join("\n\n");
    return { chunks: formatted, paths };
  } catch (err) {
    console.warn(`[docs] retrieval skipped: ${err.message}`);
    return { chunks: "", paths: [] };
  }
}

// ---------------------------------------------------------------------------
// Context builders — each returns { contextText, sourceFiles }
// ---------------------------------------------------------------------------

async function buildOverviewContext(repositoryId, repoDoc) {
  const analyses = await FileAnalysis.find({ repositoryId }).lean();
  const analyzedFiles = analyses.length;
  const totalLines = analyses.reduce((s, a) => s + (a.linesOfCode || 0), 0);
  const totalFunctions = analyses.reduce((s, a) => s + (a.functions || []).length, 0);
  const totalClasses = analyses.reduce((s, a) => s + (a.classes || []).length, 0);
  const avgComplexity =
    analyzedFiles === 0 ? 0 : Math.round(analyses.reduce((s, a) => s + a.complexityScore, 0) / analyzedFiles * 100) / 100;
  const totalLint = analyses.reduce((s, a) => s + (a.lintIssues || []).length, 0);
  const languages = countLanguages(analyses);

  const readmeFile = await RepositoryFile.findOne({
    repositoryId,
    path: { $regex: /(^|\/)readme/i },
  }).lean().catch(() => null);
  const readmeContent = readmeFile ? boundedLines(readmeFile.content, 250) : null;

  const { chunks: retrievalText, paths: retrievalPaths } = await retrieveContext(repositoryId);

  const lines = [
    `## Repository metadata`,
    `- Full name: ${repoDoc.fullName}`,
    `- Description: ${repoDoc.description || "(none)"}`,
    `- Primary language: ${repoDoc.language || "(not specified)"}`,
    `- Topics: ${(repoDoc.topics || []).join(", ") || "(none)"}`,
    `- Stars: ${repoDoc.starCount ?? 0}`,
    `- Total files: ${repoDoc.fileCount || 0}`,
    "",
    `## Aggregate statistics`,
    `- Analyzed files (JS/TS): ${analyzedFiles}`,
    `- Languages: ${languages}`,
    `- Total lines of code: ${totalLines.toLocaleString()}`,
    `- Functions: ${totalFunctions}`,
    `- Classes: ${totalClasses}`,
    `- Average complexity score: ${avgComplexity}`,
    `- Lint issues: ${totalLint}`,
  ];

  if (readmeContent) {
    lines.push("", "## README (first 250 lines)", "", "```markdown", readmeContent, "```");
  }

  if (retrievalText) {
    lines.push("", "## Relevant context (semantic search)", "", retrievalText);
  }

  const sourceFiles = [
    ...(readmeFile ? [readmeFile.path] : []),
    ...retrievalPaths,
  ];

  return { contextText: lines.join("\n"), sourceFiles };
}

async function buildArchitectureContext(repositoryId) {
  const graph = await buildDependencyGraph(repositoryId);
  const analyses = await FileAnalysis.find({ repositoryId }).select({ path: 1 }).lean();
  const files = await RepositoryFile.find({ repositoryId }).select({ path: 1 }).lean();

  const topHubs = (graph.nodes || [])
    .filter((n) => n.type === "internal" && n.inDegree > 0)
    .sort((a, b) => b.inDegree - a.inDegree)
    .slice(0, 10)
    .map((n) => `${n.path} (in-degree: ${n.inDegree})`);

  const dirs = topLevelDirs(files);

  const externalPkgs = (graph.nodes || [])
    .filter((n) => n.type === "external")
    .map((n) => n.label)
    .sort()
    .slice(0, 40);

  const lines = [
    "## Dependency graph summary",
    `- Internal files with dependencies: ${graph.stats.internalFiles}`,
    `- External packages: ${graph.stats.externalPackages}`,
    `- Internal edges: ${graph.stats.internalEdges}`,
    `- External edges: ${graph.stats.externalEdges}`,
  ];

  if (topHubs.length > 0) {
    lines.push("", "## Files with highest in-degree (hub files)", "", ...topHubs.map((h) => `- ${h}`));
  }

  lines.push("", "## Directory structure", "", dirs);

  if (externalPkgs.length > 0) {
    lines.push("", "## External dependencies", "", ...externalPkgs.map((p) => `- ${p}`));
  }

  return {
    contextText: lines.join("\n"),
    sourceFiles: topHubs.map((h) => h.replace(/ \(in-degree:.*\)/, "")),
  };
}

async function buildApiContext(repositoryId) {
  const analyses = await FileAnalysis.find({ repositoryId }).lean();
  const candidates = [];

  for (const a of analyses) {
    if (TEST_PATH_RE.test(a.path)) continue; // test suites describe assertions, not the API surface
    const exports = (a.exports || []).map((e) => e.toLowerCase());
    const hasFunctions = (a.functions || []).length > 0;
    // Strong path signal (route/controller/api/endpoint segments) is enough on its
    // own — Express route files define handlers via inline arrows, so they often
    // have zero top-level *function declarations* collected by the parser.
    const strongPath = STRONG_API_PATH_RE.test(a.path);
    // Weaker signals require at least one detected function to avoid noise.
    const serverFile = SERVER_FILES_RE.test(a.path);
    const apiExport =
      exports.some((e) => API_EXPORT_RE.test(e)) ||
      exports.some((e) => API_PREFIX_RE.test(e));

    if (strongPath || ((serverFile || apiExport) && hasFunctions)) {
      candidates.push(a);
    }
  }

  const picked = candidates.slice(0, 15);
  if (picked.length === 0) {
    return {
      contextText:
        "## API / Route files\n\nNo files matching common route/controller/API patterns were found in this repository.",
      sourceFiles: [],
    };
  }

  const excerpts = [];
  const fileLookup = new Map();
  const repoFiles = await RepositoryFile.find({
    repositoryId,
    path: { $in: picked.map((p) => p.path) },
  }).lean();
  for (const f of repoFiles) fileLookup.set(f.path, f);

  for (const a of picked) {
    const fns = (a.functions || [])
      .map((fn) => `- ${fn.name} (line ${fn.line})`)
      .join("\n");
    const exports = (a.exports || []).join(", ");
    const file = fileLookup.get(a.path);
    const content = file ? boundedLines(file.content, 150) : "(content unavailable)";

    excerpts.push(
      `### ${a.path}`,
      `- Language: ${a.language}`,
      `- Exports: ${exports}`,
      `- Functions:\n${fns || "  (none detected)"}`,
      "",
      "```",
      content,
      "```"
    );
  }

  return {
    contextText: `## API / Route files (${picked.length} of ${candidates.length} found)\n\n${excerpts.join("\n")}`,
    sourceFiles: picked.map((p) => p.path),
  };
}

async function buildModulesContext(repositoryId) {
  const analyses = await FileAnalysis.find({ repositoryId }).lean();

  const groups = {};
  for (const a of analyses) {
    const parts = a.path.split("/");
    const dir = parts.length > 1 ? parts[0] : "(root)";
    if (!groups[dir]) groups[dir] = [];
    groups[dir].push(a);
  }

  const sorted = Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
  const sectionCount = 20;
  const display = sorted.slice(0, sectionCount);

  const lines = [];
  const sourceFiles = [];

  for (const [dir, files] of display) {
    const shown = files.slice(0, 15);
    const more = files.length - shown.length;
    lines.push(`## ${dir}/ (${files.length} files)`);
    lines.push("");
    for (const f of shown) {
      const exports = (f.exports || []).slice(0, 5).join(", ");
      const imports = (f.imports || []).length;
      lines.push(`- **${path.basename(f.path)}** — exports: ${exports || "(none)"} · imports: ${imports} · ${f.linesOfCode || 0} lines`);
      sourceFiles.push(f.path);
    }
    if (more > 0) lines.push(`- ... and ${more} more files`);
    lines.push("");
  }

  if (sorted.length > sectionCount) {
    lines.push(`(${sorted.length - sectionCount} additional directories omitted)`);
  }

  return { contextText: lines.join("\n"), sourceFiles };
}

async function buildSetupContext(repositoryId) {
  const pkgFiles = await RepositoryFile.find({
    repositoryId,
    path: { $regex: /package\.json$/ },
  }).lean();
  const envFiles = await RepositoryFile.find({
    repositoryId,
    path: { $regex: /\.env[._]/i },
  }).lean();

  const envExamples = envFiles.filter((f) => ENV_EXAMPLE_RE.test(path.basename(f.path)));

  const lines = [];
  const sourceFiles = [];

  const rootPkg = pkgFiles.find((f) => !f.path.includes("/")) || pkgFiles[0];
  const otherPkgs = pkgFiles.filter((f) => f !== rootPkg).slice(0, 3);

  for (const pkg of [rootPkg, ...otherPkgs].filter(Boolean)) {
    let parsed;
    try {
      parsed = JSON.parse(pkg.content || "{}");
    } catch {
      parsed = {};
    }
    const scripts = parsed.scripts || {};
    const deps = parsed.dependencies || {};
    const devDeps = parsed.devDependencies || {};
    const pkgName = parsed.name || path.dirname(pkg.path);

    sourceFiles.push(pkg.path);
    lines.push(`## ${pkg.path}`);
    lines.push(`- Package name: ${pkgName}`);

    if (Object.keys(scripts).length > 0) {
      lines.push("", "### Scripts", "");
      for (const [name, cmd] of Object.entries(scripts).slice(0, 20)) {
        lines.push(`- \`${name}\`: \`${cmd}\``);
      }
    }
    if (Object.keys(deps).length > 0) {
      lines.push("", `### Dependencies (${Object.keys(deps).length} total)`, "");
      for (const [name, ver] of Object.entries(deps).slice(0, 30)) {
        lines.push(`- ${name} ${ver}`);
      }
    }
    if (Object.keys(devDeps).length > 0) {
      lines.push("", `### Dev Dependencies (${Object.keys(devDeps).length} total)`, "");
      for (const [name, ver] of Object.entries(devDeps).slice(0, 30)) {
        lines.push(`- ${name} ${ver}`);
      }
    }
    lines.push("");
  }

  if (envExamples.length > 0) {
    lines.push("## Environment variable templates", "");
    for (const env of envExamples.slice(0, 5)) {
      sourceFiles.push(env.path);
      lines.push(`### ${env.path}`, "", "```", boundedLines(env.content, 60), "```", "");
    }
  }

  return { contextText: lines.join("\n"), sourceFiles };
}

async function buildContributingContext(repositoryId) {
  const analyses = await FileAnalysis.find({ repositoryId }).lean();
  const allFiles = await RepositoryFile.find({ repositoryId }).select({ path: 1 }).lean();
  const filePaths = allFiles.map((f) => f.path);

  const testCount = filePaths.filter((p) => TEST_FILE_RE.test(p)).length;
  const srcCount = filePaths.filter((p) => SRC_RE.test(p)).length;
  const testFiles = filePaths.filter((p) => TEST_FILE_RE.test(p)).slice(0, 5);
  const lintConfigFiles = filePaths.filter((p) => /eslint|prettier/i.test(path.basename(p))).slice(0, 5);

  const pkgFile = await RepositoryFile.findOne({
    repositoryId,
    path: "package.json",
  }).lean().catch(() => null);

  let scripts = {};
  let lintScript = null;
  let testScript = null;
  if (pkgFile) {
    try {
      const pkg = JSON.parse(pkgFile.content || "{}");
      scripts = pkg.scripts || {};
      if (scripts.lint) lintScript = scripts.lint;
      if (scripts.test) testScript = scripts.test;
      if (scripts["type-check"]) lintScript = lintScript || scripts["type-check"];
    } catch {}
  }

  const lines = [
    "## Contributing context",
    "",
    `- Source files (JS/TS): ${srcCount}`,
    `- Test files found: ${testCount}`,
    `- Test convention: ${testCount > 0 ? "Files matching *.test.*, *.spec.*, or in __tests__/ directories" : "No test files found in repository"}`,
  ];

  if (testFiles.length > 0) {
    lines.push("", "### Example test files", "");
    for (const f of testFiles) lines.push(`- ${f}`);
  }
  if (pkgFile) {
    lines.push("", "### package.json (root)", "", "```json", boundedLines(pkgFile.content, 60), "```");
  }

  if (lintScript) {
    lines.push(`- Lint command: \`npm run ${Object.entries(scripts).find(([, v]) => v === lintScript)?.[0] || "lint"}\``);
  } else {
    lines.push("- Lint command: not configured in package.json scripts");
  }
  if (testScript) {
    lines.push(`- Test command: \`npm test\``);
  } else {
    lines.push("- Test command: not configured in package.json scripts");
  }
  if (lintConfigFiles.length > 0) {
    lines.push("", "### Lint / format config files", "");
    for (const f of lintConfigFiles) lines.push(`- ${f}`);
  }

  return {
    contextText: lines.join("\n"),
    sourceFiles: [...new Set([...(lintConfigFiles || []), ...(testFiles || []), ...(pkgFile ? [pkgFile.path] : [])])],
  };
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

function overviewPrompt(ctx) {
  return `You are CodeLens, an AI assistant that generates documentation for a specific codebase.

Generate a **Project Overview** section in Markdown for this repository.

Documentation rules:
- Base every statement on the repository context below. Never invent files, features, or commands not present in it.
- Structure your output with: a one-paragraph summary of what this project is and does, a bullet list of the primary directories/modules, a small stats table, and any notable details from the README.
- If a README is provided, respect its stated purpose. If there is little README content, infer from the code structure alone and keep it brief.
- Use Markdown headings and keep it factual.

${ctx.contextText}`;
}

function architecturePrompt(ctx) {
  return `You are CodeLens, an AI assistant that generates documentation for a specific codebase.

Generate an **Architecture Explanation** section in Markdown for this repository.

Documentation rules:
- Base every statement on the repository context below. Never invent files, imports, or patterns not present in the data.
- Structure: a short architectural overview, a section on the key hub files and why they matter, a directory layout summary, and the external dependency picture.
- Highlight the layered structure (if any) and the main data/request flow.
- Be concise and cite actual file paths.

${ctx.contextText}`;
}

function apiPrompt(ctx) {
  return `You are CodeLens, an AI assistant that generates documentation for a specific codebase.

Generate an **API / Routes Description** section in Markdown for this repository.

Documentation rules:
- Base every statement on the code excerpts provided. Never invent endpoints, methods, or parameters not visible in the code.
- Structure: for each API/route file, describe the file's role (e.g. route definitions, middleware, handlers) and list the exported functions with their apparent purpose.
- If app.get(...), router.post(...) style code is visible, mention the route paths and methods. Otherwise, infer purpose from function names.
- If no API or route files were found, state that clearly.

${ctx.contextText}`;
}

function modulesPrompt(ctx) {
  return `You are CodeLens, an AI assistant that generates documentation for a specific codebase.

Generate a **Module Summaries** section in Markdown for this repository.

Documentation rules:
- Base every statement on the repository context below. Never invent module purposes not supported by the file names, imports, or exports shown.
- Structure: for each top-level directory, write a brief summary of that directory's apparent purpose based on the files it contains and what those files import/export.
- Mention the most important files in each module by name.
- If a root-level directory contains only configuration or boilerplate, say so.

${ctx.contextText}`;
}

function setupPrompt(ctx) {
  return `You are CodeLens, an AI assistant that generates documentation for a specific codebase.

Generate a **Setup Instructions** section in Markdown for this repository.

Documentation rules:
- Base every command and step on the package.json scripts and environment files provided. Never invent install or run commands not present in the data.
- Structure with clear Markdown sections: Prerequisites, Installation, Running the project, Running tests (if test script exists), Linting (if lint script exists), Environment Variables (from any .env example files provided).
- Use the actual script names from package.json.

${ctx.contextText}`;
}

function contributingPrompt(ctx) {
  return `You are CodeLens, an AI assistant that generates documentation for a specific codebase.

Generate a **Contribution Guidelines** section in Markdown for this repository.

Documentation rules:
- Base every guideline on the lint configuration, test conventions, and scripts shown in the context below. Do not invent CI/CD steps, testing frameworks, or code standards not evidenced by the data.
- Structure: Getting Started, Branching Workflow, Code Style (reference lint setup if present), Testing (reference actual test convention found), Pull Request Checklist, and a short Code of Conduct placeholder.
- Keep it practical and specific to this repository.

${ctx.contextText}`;
}

// ---------------------------------------------------------------------------
// Dispatch + upsert
// ---------------------------------------------------------------------------

const PROMPT_BUILDERS = {
  overview: overviewPrompt,
  architecture: architecturePrompt,
  api: apiPrompt,
  modules: modulesPrompt,
  setup: setupPrompt,
  contributing: contributingPrompt,
};

const CONTEXT_BUILDERS = {
  overview: buildOverviewContext,
  architecture: buildArchitectureContext,
  api: buildApiContext,
  modules: buildModulesContext,
  setup: buildSetupContext,
  contributing: buildContributingContext,
};

async function generateSection(repositoryId, sectionType, repoDoc) {
  const buildContext = CONTEXT_BUILDERS[sectionType];
  const buildPrompt = PROMPT_BUILDERS[sectionType];
  if (!buildContext || !buildPrompt) {
    throw new Error(`Unknown section type: ${sectionType}`);
  }
  const ctx = await buildContext(repositoryId, repoDoc);
  const prompt = buildPrompt(ctx);
  const result = await generateText(prompt, { temperature: 0.3, maxOutputTokens: 4096 });
  return { content: result.answer, sourceFiles: [...new Set(ctx.sourceFiles || [])] };
}

function docIsFresh(doc, repoDoc) {
  if (!doc || !doc.generatedAt) return false;
  if (!repoDoc.analysisCompletedAt) return true;
  return doc.generatedAt >= repoDoc.analysisCompletedAt;
}

module.exports = {
  SECTION_TYPES,
  generateSection,
  docIsFresh,
};
