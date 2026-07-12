const { config } = require("./config");
const { getApiKeyByToken } = require("./db");
const { timingSafeEqualStr } = require("./security");

function extractBearer(req) {
  const h = req.headers.authorization || "";
  if (h.toLowerCase().startsWith("bearer ")) return h.slice(7).trim();
  if (req.headers["x-api-key"]) return String(req.headers["x-api-key"]).trim();
  // Intentionally NO query-string tokens (leak via logs/referrers)
  return null;
}

function requireGatewayAuth(req, res, next) {
  const token = extractBearer(req);
  const key = getApiKeyByToken(token);
  if (!key) {
    return res.status(401).json({ error: "Unauthorized (gateway API key)" });
  }
  req.gatewayKey = key;
  next();
}

function requireAdminAuth(req, res, next) {
  const token = extractBearer(req);
  if (!token || !timingSafeEqualStr(token, config.adminToken)) {
    return res.status(401).json({ error: "Unauthorized (admin token)" });
  }
  next();
}

module.exports = {
  extractBearer,
  requireGatewayAuth,
  requireAdminAuth,
};
