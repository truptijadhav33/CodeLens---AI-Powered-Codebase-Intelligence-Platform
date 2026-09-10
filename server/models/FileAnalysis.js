const mongoose = require("mongoose");

const functionSchema = new mongoose.Schema(
  {
    name: String,
    line: Number,
    complexity: Number,
  },
  { _id: false }
);

const classSchema = new mongoose.Schema(
  {
    name: String,
    line: Number,
  },
  { _id: false }
);

const lintIssueSchema = new mongoose.Schema(
  {
    ruleId: String,
    severity: { type: String, enum: ["warning", "error"] },
    message: String,
    line: Number,
    column: Number,
  },
  { _id: false }
);

const fileAnalysisSchema = new mongoose.Schema(
  {
    repositoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Repository",
      required: true,
      index: true,
    },
    path: { type: String, required: true },
    language: String,
    imports: { type: [String], default: [] },
    exports: { type: [String], default: [] },
    functions: { type: [functionSchema], default: [] },
    classes: { type: [classSchema], default: [] },
    lintIssues: { type: [lintIssueSchema], default: [] },
    complexityScore: { type: Number, default: 0 },
    linesOfCode: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["analyzed", "parse_error"],
      default: "analyzed",
    },
    parseError: String,
    analyzedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

fileAnalysisSchema.index({ repositoryId: 1, path: 1 }, { unique: true });

module.exports = mongoose.model("FileAnalysis", fileAnalysisSchema);