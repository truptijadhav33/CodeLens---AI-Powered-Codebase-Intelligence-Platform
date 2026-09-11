const CHUNK_TOKENS = 650;
const CHUNK_CHARS = CHUNK_TOKENS * 4;
const OVERLAP_TOKENS = 120;
const OVERLAP_CHARS = OVERLAP_TOKENS * 4;

function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

function isMarkdownPath(filePath) {
  return filePath.toLowerCase().endsWith(".md");
}

function isJsTsPath(filePath) {
  return /\.(js|jsx|ts|tsx)$/i.test(filePath);
}

function splitFixedSize(text, chunkChars = CHUNK_CHARS, overlapChars = OVERLAP_CHARS) {
  if (!text || text.trim().length === 0) return [];
  if (text.length <= chunkChars) return [text];
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + chunkChars, text.length);
    chunks.push(text.slice(start, end));
    if (end >= text.length) break;
    start = end - overlapChars;
    if (start < 0) start = 0;
  }
  return chunks;
}

function chunkJsFile(content, filePath, fileAnalysis) {
  const analyses = fileAnalysis ? [fileAnalysis] : [];
  const funcs = analyses.length
    ? [...(fileAnalysis.functions || []), ...(fileAnalysis.classes || []).map((c) => ({ name: c.name, line: c.line }))]
    : [];

  if (funcs.length === 0) {
    return splitFixedSize(content).map((c) => `File: ${filePath}\n${c}`);
  }

  const lines = content.split("\n");
  const sorted = [...funcs].sort((a, b) => a.line - b.line);
  const chunks = [];

  // Header region before first function (imports / top-level)
  const firstLine = sorted[0].line;
  if (firstLine > 2) {
    const header = lines.slice(0, firstLine - 1).join("\n").trim();
    if (header) {
      for (const part of splitFixedSize(header)) {
        chunks.push(`File: ${filePath} (header)\n${part}`);
      }
    }
  }

  for (let i = 0; i < sorted.length; i++) {
    const startLine = sorted[i].line;
    const endLine = i + 1 < sorted.length ? sorted[i + 1].line - 1 : lines.length;
    const slice = lines.slice(startLine - 1, endLine).join("\n").trim();
    if (!slice) continue;
    const label = sorted[i].name ? `Function/Class: ${sorted[i].name}` : `Block at line ${startLine}`;
    const prefix = `File: ${filePath}\n${label}\n`;
    const available = CHUNK_CHARS - prefix.length;
    if (slice.length <= available) {
      chunks.push(prefix + slice);
    } else {
      const parts = splitFixedSize(slice, available, OVERLAP_CHARS);
      for (const part of parts) chunks.push(prefix + part);
    }
  }

  if (chunks.length === 0) {
    return splitFixedSize(content).map((c) => `File: ${filePath}\n${c}`);
  }
  return chunks;
}

function chunkMarkdownFile(content, filePath) {
  const parts = splitFixedSize(content);
  return parts.map((c) => `File: ${filePath}\n${c}`);
}

function chunkFile(content, filePath, fileAnalysis) {
  if (isJsTsPath(filePath)) return chunkJsFile(content, filePath, fileAnalysis);
  if (isMarkdownPath(filePath)) return chunkMarkdownFile(content, filePath);
  return [];
}

function isEligibleFile(filePath) {
  return isJsTsPath(filePath) || isMarkdownPath(filePath);
}

module.exports = {
  chunkFile,
  chunkJsFile,
  chunkMarkdownFile,
  splitFixedSize,
  estimateTokens,
  isEligibleFile,
  isMarkdownPath,
  isJsTsPath,
  CHUNK_TOKENS,
  OVERLAP_TOKENS,
};