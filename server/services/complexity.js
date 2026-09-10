const { visit } = require("./codeParser");

// Cyclomatic-complexity approximation: 1 (base) + one per branch. Branches
// counted: if/else, loops, switch cases (excluding default), ternaries, and
// logical && / || operators.
function countBranches(fnNode) {
  let count = 0;
  visit(fnNode, (node) => {
    switch (node.type) {
      case "IfStatement":
      case "ConditionalExpression":
      case "ForStatement":
      case "ForInStatement":
      case "ForOfStatement":
      case "WhileStatement":
      case "DoWhileStatement":
        count += 1;
        break;
      case "LogicalExpression":
        if (node.operator === "&&" || node.operator === "||") count += 1;
        break;
      case "SwitchCase":
        if (node.test) count += 1;
        break;
      default:
        break;
    }
  });
  return count + 1;
}

// Takes the parse result produced by codeParser.parseFile and attaches a
// per-function complexity plus an aggregate complexityScore for the file.
function analyzeFile(parseResult) {
  if (parseResult.unsupported || parseResult.parseError || !parseResult.ast) {
    return null;
  }
  const functions = (parseResult.functions || []).map(({ name, line, node }) => ({
    name,
    line,
    complexity: countBranches(node),
  }));
  const complexityScore = Math.max(
    functions.reduce((sum, f) => sum + f.complexity, 0),
    1
  );
  return { functions, complexityScore };
}

module.exports = { countBranches, analyzeFile };