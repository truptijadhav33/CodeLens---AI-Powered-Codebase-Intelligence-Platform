const crypto = require("crypto");

const ENC_PREFIX = "clenc:v1:";
const IV_LEN = 12;
const TAG_LEN = 16;

function getKey() {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error("ENCRYPTION_KEY is not configured. Set it in server/.env");
  }
  // Accept a 64-char hex string (32 bytes) or derive a key from any passphrase.
  if (/^[0-9a-fA-F]{64}$/.test(key)) {
    return Buffer.from(key, "hex");
  }
  return crypto.createHash("sha256").update(String(key)).digest();
}

function isEncrypted(value) {
  return typeof value === "string" && value.startsWith(ENC_PREFIX);
}

function encryptToken(plaintext) {
  if (plaintext == null || plaintext === "") return plaintext;
  if (isEncrypted(plaintext)) return plaintext;

  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(String(plaintext), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return ENC_PREFIX + Buffer.concat([iv, tag, encrypted]).toString("base64");
}

function decryptToken(ciphertext) {
  if (ciphertext == null || ciphertext === "") return ciphertext;
  if (!isEncrypted(ciphertext)) {
    // Legacy plaintext that the one-time migration missed. Keep authentication
    // working but flag it so it gets migrated.
    console.warn("[token-encryption] decrypting a plaintext accessToken — run scripts/encryptExistingTokens.js");
    return ciphertext;
  }

  const raw = Buffer.from(ciphertext.slice(ENC_PREFIX.length), "base64");
  if (raw.length < IV_LEN + TAG_LEN + 1) {
    throw new Error("Malformed encrypted token payload");
  }

  const iv = raw.subarray(0, IV_LEN);
  const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const data = raw.subarray(IV_LEN + TAG_LEN);

  const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

module.exports = { encryptToken, decryptToken, isEncrypted, ENC_PREFIX };