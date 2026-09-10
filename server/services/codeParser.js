const parser = require("@babel/parser");

const SUPPORTED_EXTENSIONS = new Set(["js", "jsx", "ts", "tsx"]);

function getLanguage(filePath) {
  const ext = filePath.split(".").pop().toLowerCase();
  return SUPPORTED_EXTENSIONS.has(ext) ? ext : null;
}

function linesOfCode(content) {
  return content.split("\n").filter((line) => line.trim().length > 0).length;
}

// Collect import sources from any ImportDeclaration in the AST.
function collectImports(ast) {
  const sources = new Set();
  visit(ast, (node) => {
    if (node.type === "ImportDeclaration" && node.source) {
      sources.add(node.source.value);
    }
  });
  return [...sources];
}

// Collect exported names: default exports, named declarations, re-exports.
function collectExports(ast) {
  const names = [];
  visit(ast, (node) => {
    if (node.type === "ExportDefaultDeclaration") {
      names.push("default");
    } else if (node.type === "ExportAllDeclaration") {
      names.push("*");
    } else if (node.type === "ExportNamedDeclaration") {
      if (node.declaration) {
        if (node.declaration.id) names.push(node.declaration.id.name);
        else if (node.declaration.declarations) {
          for (const d of node.declaration.declarations || []) {
            if (d.id && d.id.name) names.push(d.id.name);
          }
        }
      }
      for (const spec of node.specifiers || []) {
        names.push(spec.exported.name || spec.exported.value || spec.local.name);
      }
    }
  });
  return [...new Set(names)];
}

// Top-level function declarations (also inside export declarations), returned
// alongside their AST node so the caller can compute per-function complexity.
function collectFunctions(ast) {
  const functions = [];
  const programBody = ast.program ? ast.program.body : ast.body;
  for (const stmt of programBody || []) {
    const node = unwrapExport(stmt);
    if (node && node.type === "FunctionDeclaration") {
      functions.push({
        name: node.id?.name || "<anonymous>",
        line: node.loc.start.line,
        node,
      });
    } else if (node && node.type === "ClassDeclaration") {
      for (const member of node.body?.body || []) {
        if (member.type === "ClassMethod" || member.type === "ClassProperty") {
          const fnNode = member.value && member.value.type === "ArrowFunctionExpression" ? member.value : member;
          functions.push({
            name: member.key?.name || "<anonymous>",
            line: member.loc?.start.line,
            node: fnNode,
          });
        }
      }
    }
  }
  return functions;
}

function collectClasses(ast) {
  const classes = [];
  const programBody = ast.program ? ast.program.body : ast.body;
  for (const stmt of programBody || []) {
    const node = unwrapExport(stmt);
    if (node && node.type === "ClassDeclaration") {
      classes.push({ name: node.id?.name || "<anonymous>", line: node.loc.start.line });
    }
  }
  return classes;
}

function unwrapExport(stmt) {
  if (
    stmt.type === "ExportNamedDeclaration" ||
    stmt.type === "ExportDefaultDeclaration"
  ) {
    return stmt.declaration;
  }
  return stmt;
}

// Generic recursive AST walker.
function visit(node, fn) {
  if (!node || typeof node !== "object") return;
  fn(node);
  if (Array.isArray(node)) {
    for (const child of node) visit(child, fn);
    return;
  }
  for (const key of Object.keys(node)) {
    if (key === "loc" || key === "start" || key === "end" || key === "leadingComments" || key === "trailingComments") continue;
    const value = node[key];
    if (value && typeof value === "object") visit(value, fn);
  }
}

function parseFile(content, filePath) {
  const language = getLanguage(filePath);
  if (!language) {
    return { language: null, unsupported: true };
  }
  const plugins = ["jsx", "typescript"];
  if (language === "ts") plugins.push("typescript");
  try {
    const ast = parser.parse(content, {
      sourceType: "module",
      plugins,
      errorRecovery: false,
      allowAwaitOutsideFunction: true,
      attachComment: false,
    });
    return {
      language,
      unsupported: false,
      ast,
      imports: collectImports(ast),
      exports: collectExports(ast),
      functions: collectFunctions(ast),
      classes: collectClasses(ast),
      linesOfCode: linesOfCode(content),
    };
  } catch (err) {
    return {
      language,
      unsupported: false,
      parseError: err.message,
      linesOfCode: linesOfCode(content),
    };
  }
}

module.exports = { parseFile, getLanguage, SUPPORTED_EXTENSIONS, visit };