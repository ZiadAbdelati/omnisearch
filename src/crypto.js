const crypto = require("crypto");
const { config } = require("./config");

const ALGO = "aes-256-gcm";

function keyMaterial() {
  return crypto.createHash("sha256").update(String(config.secretKey)).digest();
}

/** Seal a secret string for DB storage. Empty/null → null. */
function seal(plain) {
  if (plain == null || plain === "") return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, keyMaterial(), iv);
  const enc = Buffer.concat([
    cipher.update(String(plain), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

function open(sealed) {
  if (sealed == null || sealed === "") return null;
  const buf = Buffer.from(String(sealed), "base64");
  if (buf.length < 28) throw new Error("Invalid sealed secret");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = crypto.createDecipheriv(ALGO, keyMaterial(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    "utf8",
  );
}

function redactSecret(secret) {
  if (!secret) return null;
  const s = String(secret);
  if (s.length <= 8) return "••••";
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

module.exports = { seal, open, redactSecret };
