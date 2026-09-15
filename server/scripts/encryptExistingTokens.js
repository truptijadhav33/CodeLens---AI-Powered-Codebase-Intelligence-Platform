// One-time migration: encrypt any plaintext GitHub accessToken already stored in
// the User collection. Safe to re-run — already-encrypted tokens are skipped.
//
// Usage:  node scripts/encryptExistingTokens.js
// (run from the server/ directory so dotenv picks up server/.env)

require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../models/User");
const { encryptToken, isEncrypted, ENC_PREFIX } = require("../services/tokenEncryption");

async function main() {
  const MONGODB_URI = process.env.MONGODB_URI;
  if (!MONGODB_URI) {
    throw new Error("MONGODB_URI is not set in server/.env");
  }
  if (!process.env.ENCRYPTION_KEY) {
    throw new Error(
      "ENCRYPTION_KEY is not set. Add it to server/.env BEFORE running this script —" +
        " encrypted tokens require the same key to be decryptable later."
    );
  }

  await mongoose.connect(MONGODB_URI);

  const users = await User.find({ accessToken: { $not: new RegExp("^" + ENC_PREFIX.replace(/[:.]/g, "\\$&")) } }).lean();

  let encrypted = 0;
  for (const user of users) {
    if (!user.accessToken || isEncrypted(user.accessToken)) continue;
    await User.updateOne(
      { _id: user._id },
      { $set: { accessToken: encryptToken(user.accessToken) } }
    );
    encrypted += 1;
    console.log(`Encrypted token for ${user.username} (${String(user._id)})`);
  }

  console.log(`\nDone. Encrypted ${encrypted} of ${users.length} unconverted user document(s).`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Migration failed:", err.message);
  process.exit(1);
});