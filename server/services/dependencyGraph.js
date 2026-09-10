const path = require("path");
const FileAnalysis = require("../models/FileAnalysis");
const RepositoryFile = require("../models/RepositoryFile");

const EXTENSIONS = [".js", ".jsx", ".ts", ".tsx"];
const INDEX_SUFFIXES = EXTENSIONS.map((ext) => `/index${ext}`);

function extractPackageName(importStr) {
  if (!importStr || importStr.startsWith(".") || importStr.startsWith("/")) return null;
  if (importStr.startsWith("@")) {
    const parts = importStr.split("/");
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : parts[0];
  }
  return importStr.split("/")[0];
}

function isRelativeImport(importStr) {
  return importStr.startsWith("./") || importStr.startsWith("../") || importStr.startsWith("/");
}

function normalizeImportPath(importStr) {
  return importStr.split("?")[0].split("#")[0];
}

function resolveRelativeImport(importingFilePath, importStr, repoFileSet) {
  const cleaned = normalizeImportPath(importStr);
  const baseDir = path.posix.dirname(importingFilePath);
  const resolvedBase = path.posix.join(baseDir, cleaned);
  const normalizedBase = path.posix.normalize(resolvedBase);

  const candidates = [
    normalizedBase,
    ...EXTENSIONS.map((ext) => `${normalizedBase}${ext}`),
    ...INDEX_SUFFIXES.map((suffix) => `${normalizedBase}${suffix}`),
  ];

  for (const candidate of candidates) {
    if (repoFileSet.has(candidate)) return candidate;
  }
  return null;
}

async function buildDependencyGraph(repositoryId) {
  const [analyses, repoFiles] = await Promise.all([
    FileAnalysis.find({ repositoryId }).select({ path: 1, imports: 1 }).lean(),
    RepositoryFile.find({ repositoryId }).select({ path: 1 }).lean(),
  ]);

  const repoFileSet = new Set(repoFiles.map((f) => f.path));
  const analyzedPaths = new Set(analyses.map((a) => a.path));

  const inDegree = new Map();
  for (const p of analyzedPaths) inDegree.set(p, 0);

  const externalPackages = new Set();
  const edges = [];

  for (const file of analyses) {
    const imports = file.imports || [];
    for (const rawImport of imports) {
      if (!rawImport || typeof rawImport !== "string") continue;

      if (isRelativeImport(rawImport)) {
        const resolved = resolveRelativeImport(file.path, rawImport, repoFileSet);
        if (resolved && analyzedPaths.has(resolved)) {
          edges.push({ source: file.path, target: resolved, type: "internal" });
          inDegree.set(resolved, (inDegree.get(resolved) || 0) + 1);
        }
        // Unresolvable or unsupported-language target: skip (only analyzed files become nodes)
      } else {
        const pkg = extractPackageName(rawImport);
        if (pkg) {
          externalPackages.add(pkg);
          edges.push({ source: file.path, target: pkg, type: "external" });
        }
      }
    }
  }

  const internalNodes = [...inDegree.keys()].map((filePath) => ({
    id: filePath,
    label: filePath.split("/").pop() || filePath,
    path: filePath,
    type: "internal",
    inDegree: inDegree.get(filePath) || 0,
  }));

  const externalNodes = [...externalPackages].map((pkg) => ({
    id: `ext:${pkg}`,
    label: pkg,
    packageName: pkg,
    type: "external",
  }));

  const normalizedEdges = edges.map((e) => ({
    source: e.source,
    target: e.type === "external" ? `ext:${e.target}` : e.target,
    type: e.type,
  }));

  const nodes = [...internalNodes, ...externalNodes];
  const largeGraph = nodes.length > 300;

  return {
    nodes,
    edges: normalizedEdges,
    stats: {
      internalFiles: internalNodes.length,
      externalPackages: externalNodes.length,
      totalNodes: nodes.length,
      internalEdges: normalizedEdges.filter((e) => e.type === "internal").length,
      externalEdges: normalizedEdges.filter((e) => e.type === "external").length,
    },
    warning: largeGraph ? "large graph, consider filtering" : null,
  };
}

module.exports = { buildDependencyGraph, extractPackageName, resolveRelativeImport };