const mongoose = require("mongoose");

const documentationSchema = new mongoose.Schema(
  {
    repositoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Repository",
      required: true,
      index: true,
    },
    sectionType: {
      type: String,
      enum: ["overview", "architecture", "api", "modules", "setup", "contributing"],
      required: true,
    },
    content: { type: String, default: "" },
    sourceFiles: { type: [String], default: [] },
    generatedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

documentationSchema.index({ repositoryId: 1, sectionType: 1 }, { unique: true });

module.exports = mongoose.model("Documentation", documentationSchema);
