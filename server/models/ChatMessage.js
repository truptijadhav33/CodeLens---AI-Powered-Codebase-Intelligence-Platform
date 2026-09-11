const mongoose = require("mongoose");

const chatMessageSchema = new mongoose.Schema(
  {
    repositoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Repository",
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    role: { type: String, enum: ["user", "assistant"], required: true },
    content: { type: String, required: true },
    sourceFiles: { type: [String], default: [] },
  },
  { timestamps: true }
);

chatMessageSchema.index({ repositoryId: 1, userId: 1, createdAt: -1 });

module.exports = mongoose.model("ChatMessage", chatMessageSchema);