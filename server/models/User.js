const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    githubId: { type: String, required: true, unique: true },
    username: { type: String, required: true },
    avatarUrl: String,
    // NOTE: In production, encrypt this field before persisting (e.g. AES-256-GCM
    // using a key from an env var). Phase 1 stores it plainly for local development.
    accessToken: { type: String, required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);