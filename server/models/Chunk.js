const mongoose = require("mongoose");

const chunkSchema = new mongoose.Schema(
  {
    repositoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Repository",
      required: true,
      index: true,
    },
    path: { type: String, required: true },
    chunkIndex: { type: Number, required: true },
    content: { type: String, required: true },
    contentHash: { type: String, default: undefined },
    embeddingModel: { type: String, default: null },
    embedding: { type: [Number], default: undefined },
    tokenCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

chunkSchema.index({ repositoryId: 1, path: 1, chunkIndex: 1 }, { unique: true });

module.exports = mongoose.model("Chunk", chunkSchema);