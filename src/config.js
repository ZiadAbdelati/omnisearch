const path = require("path");
const fs = require("fs");

function loadDotEnv() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadDotEnv();

const root = process.cwd();

const config = {
  host: process.env.HOST || "0.0.0.0",
  port: Number(process.env.PORT || 8787),
  secretKey: process.env.SECRET_KEY || "dev-insecure-secret-key-change-me",
  adminToken: process.env.ADMIN_TOKEN || "admin-dev-token",
  gatewayToken: process.env.GATEWAY_API_TOKEN || "gateway-dev-token",
  databasePath:
    process.env.DATABASE_PATH || path.join(root, "data", "gateway.db"),
  defaultSearxngUrl: process.env.DEFAULT_SEARXNG_URL || "",
  providers: ["brave", "tavily", "exa", "searxng"],
  modes: ["auto", "balanced", "fresh", "semantic", "cheap"],
};

module.exports = { config };
