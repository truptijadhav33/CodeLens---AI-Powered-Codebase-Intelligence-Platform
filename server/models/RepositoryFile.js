const mongoose = require("mongoose");

// Content lives here — one document per source file — so a Repository document
// never approaches MongoDB's 16MB document cap. Multiple files (e.g. one huge
// file's content) may exceed 16MB only if a single blob itself is that big,
// which the MAX_FILE_BYTES guard already prevents.
const repositoryFileSchema = new mongoose.Schema(
  {
    repositoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Repository",
      required: true,
      index: true,
    },
    path: { type: String, required: true },
    type: { type: String, default: "file" },
    size: { type: Number, default: 0 },
    content: { type: String, default: "" },
  },
  { timestamps: true }
);

repositoryFileSchema.index({ repositoryId: 1, path: 1 }, { unique: true });

module.exports = mongoose.model("RepositoryFile", repositoryFileSchema);