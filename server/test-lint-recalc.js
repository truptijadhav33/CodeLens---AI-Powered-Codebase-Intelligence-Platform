/**
 * Re-runs the analysis pass (parser + complexity + lint) with the current
 * lintService config, persists FileAnalysis, then runs issue detection and
 * prints the combined issue breakdown. Mirrors POST /:id/analyze + detect.
 */
require("dotenv").config({ path: __dirname + "/.env" });
const mongoose = require("mongoose");

const REPO_ID = "6aa271a174eca91f333d2d9b";

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const RepositoryFile = require("./models/RepositoryFile");
  const FileAnalysis = require("./models/FileAnalysis");
  const { parseFile, getLanguage } = require("./services/codeParser");
  const { analyzeFile } = require("./services/complexity");
  const { lintContent } = require("./services/lintService");
  const { detectIssues } = require("./services/issueDetection");
  const INSERT_BATCH_SIZE = 100;

  const repoId = new mongoose.Types.ObjectId(REPO_ID);
  const repoFiles = await RepositoryFile.find({ repositoryId: repoId }).lean();
  const supported = repoFiles.filter((f) => getLanguage(f.path));
  console.log(`files: ${repoFiles.length}, supported: ${supported.length}`);

  const analysisDocs = [];
  for (const file of supported) {
    const parseResult = parseFile(file.content, file.path);
    const base = {
      repositoryId: repoId,
      path: file.path,
      language: parseResult.language,
      linesOfCode: parseResult.linesOfCode || 0,
    };
    if (parseResult.unsupported || parseResult.parseError) continue;
    const complexity = analyzeFile(parseResult);
    const lint = await lintContent(file.content, file.path);
    analysisDocs.push({
      ...base,
      status: "analyzed",
      imports: parseResult.imports,
      exports: parseResult.exports,
      functions: complexity.functions,
      classes: parseResult.classes,
      complexityScore: complexity.complexityScore,
      lintIssues: lint.lintIssues,
    });
  }

  await FileAnalysis.deleteMany({ repositoryId: repoId });
  for (let i = 0; i < analysisDocs.length; i += INSERT_BATCH_SIZE) {
    await FileAnalysis.insertMany(analysisDocs.slice(i, i + INSERT_BATCH_SIZE), { ordered: false });
  }
  console.log(`re-analyzed: ${analysisDocs.length} files persisted`);

  const { issues } = await detectIssues(repoId);
  const byType = {};
  const bySeverity = {};
  for (const i of issues) {
    byType[i.type] = (byType[i.type] || 0) + 1;
    bySeverity[i.severity] = (bySeverity[i.severity] || 0) + 1;
  }
  console.log("\n=== New issue breakdown ===");
  console.log("TOTAL:", issues.length);
  console.log("byType:", JSON.stringify(byType));
  console.log("bySeverity:", JSON.stringify(bySeverity));

  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });