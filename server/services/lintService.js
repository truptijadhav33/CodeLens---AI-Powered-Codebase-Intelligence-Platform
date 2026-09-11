const { ESLint } = require("eslint");
const js = require("@eslint/js");
const tsParser = require("@typescript-eslint/parser");
const globals = require("globals");

// Analyzed repos may be frontend (browser), backend (node), CommonJS backend
// code (require/module/exports/__dirname), or Jest test files (describe/it/
// expect/jest). We can't know per-file, so the lint pass declares all of them.
// Without this, standard globals like window, document, fetch, process, require,
// or expect fire false-positive no-undef errors.
const GLOBAL_ENV = {
  ...globals.browser,
  ...globals.node,
  ...globals.commonjs,
  ...globals.jest,
};

let eslintInstance = null;

function getESLint() {
  if (!eslintInstance) {
    eslintInstance = new ESLint({
      overrideConfigFile: true,
      overrideConfig: [
        js.configs.recommended,
        {
          files: ["**/*.{ts,tsx}"],
          languageOptions: {
            parser: tsParser,
            globals: { ...GLOBAL_ENV },
            ecmaVersion: "latest",
            sourceType: "module",
            parserOptions: { ecmaFeatures: { jsx: true } },
          },
        },
        {
          files: ["**/*.{js,jsx}"],
          languageOptions: {
            globals: { ...GLOBAL_ENV },
            ecmaVersion: "latest",
            sourceType: "module",
            parserOptions: { ecmaFeatures: { jsx: true } },
          },
        },
      ],
    });
  }
  return eslintInstance;
}

// Lints a single in-memory file. Content lives in Mongo, not on disk, so the
// ESLint class's lintText is used (lintFiles expects real files).
async function lintContent(content, filePath) {
  const [result] = await getESLint().lintText(content, { filePath });
  const lintIssues = (result.messages || [])
    .filter((m) => m.severity >= 1)
    .map((m) => ({
      ruleId: m.ruleId || "parse-error",
      severity: m.severity === 2 ? "error" : "warning",
      message: m.message,
      line: m.line || 0,
      column: m.column || 0,
    }));
  return { lintIssues, errorCount: result.errorCount, warningCount: result.warningCount };
}

module.exports = { lintContent, GLOBAL_ENV };