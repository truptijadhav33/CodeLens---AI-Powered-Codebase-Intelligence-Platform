const { ESLint } = require("eslint");
const js = require("@eslint/js");
const tsParser = require("@typescript-eslint/parser");

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
            sourceType: "module",
            ecmaVersion: 2022,
            parserOptions: { ecmaFeatures: { jsx: true } },
          },
        },
        {
          files: ["**/*.{js,jsx}"],
          languageOptions: {
            sourceType: "module",
            ecmaVersion: 2022,
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

module.exports = { lintContent };