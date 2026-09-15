const mongoose = require("mongoose");
const { encryptToken, isEncrypted } = require("../services/tokenEncryption");

const userSchema = new mongoose.Schema(
  {
    githubId: { type: String, required: true, unique: true },
    username: { type: String, required: true },
    avatarUrl: String,
    // GitHub access token, encrypted at rest with AES-256-GCM (key from
    // ENCRYPTION_KEY). Decrypted only where GitHub API calls are made.
    accessToken: { type: String, required: true },
  },
  { timestamps: true }
);

// Encrypt the token whenever a document is persisted via .save().
// Mongoose 9 middleware is async-only (no next callback) — return a promise.
userSchema.pre("save", async function () {
  if (this.isModified("accessToken") && !isEncrypted(this.accessToken)) {
    this.accessToken = encryptToken(this.accessToken);
  }
});

// .save() does not run for findOneAndUpdate-style writes; encrypt there too.
userSchema.pre("findOneAndUpdate", async function () {
  const update = this.getUpdate();
  const token = update?.$set?.accessToken;
  if (token != null && token !== "" && !isEncrypted(token)) {
    update.$set.accessToken = encryptToken(token);
  }
});

module.exports = mongoose.model("User", userSchema);