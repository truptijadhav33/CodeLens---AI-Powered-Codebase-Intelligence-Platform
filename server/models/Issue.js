const mongoose = require("mongoose");

const issueSchema = new mongoose.Schema(
  {
    repositoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Repository",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ["lint", "complexity", "missing-test", "dependency", "duplication"],
      required: true,
    },
    severity: {
      type: String,
      enum: ["low", "medium", "high"],
      required: true,
    },
    filePath: { type: String, required: true },
    relatedFilePath: { type: String, default: null },
    message: { type: String, required: true },
    detail: { type: mongoose.Schema.Types.Mixed, default: {} },
    aiExplanation: { type: String, default: null },
    aiSuggestion: { type: String, default: null },
  },
  { timestamps: true }
);

issueSchema.index({ repositoryId: 1, severity: 1 });
issueSchema.index({ repositoryId: 1, type: 1 });

// NOTE: aiExplanation/aiSuggestion use default: null (not default: undefined).
// Mongoose 9 strips fields declared with `default: undefined` even when a value
// is explicitly set, so a default of null is required for these to persist.

module.exports = mongoose.model("Issue", issueSchema);