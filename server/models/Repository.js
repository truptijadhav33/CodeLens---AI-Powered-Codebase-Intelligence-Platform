const mongoose = require("mongoose");

const repositorySchema = new mongoose.Schema(
  {
    ownerUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    githubRepoId: { type: String, required: true },
    owner: { type: String, required: true },
    name: { type: String, required: true },
    fullName: { type: String, required: true },
    description: String,
    language: String,
    defaultBranch: String,
    isPrivate: Boolean,
    topics: { type: [String], default: [] },
    starCount: { type: Number, default: 0 },
    fileCount: { type: Number, default: 0 },
    totalSizeBytes: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["pending", "ingesting", "complete", "failed"],
      default: "pending",
    },
    ingestedAt: Date,
    errorMessage: String,
  },
  { timestamps: true }
);

repositorySchema.index({ ownerUserId: 1, githubRepoId: 1 }, { unique: true });

module.exports = mongoose.model("Repository", repositorySchema);