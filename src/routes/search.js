const express = require("express");
const { requireGatewayAuth } = require("../auth");
const { executeSearch } = require("../router");

const router = express.Router();
function providerList(value) {
  if (Array.isArray(value)) return value.map(String).map((s) => s.trim()).filter(Boolean);
  if (value == null || value === "") return undefined;
  return String(value).split(",").map((s) => s.trim()).filter(Boolean);
}


router.post("/search", requireGatewayAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const result = await executeSearch({
      query: body.query || body.q,
      limit: body.limit,
      recency: body.recency,
      mode: body.mode,
      providers: providerList(body.providers),
      signal: req.signal,
      ip: req.ip || req.socket?.remoteAddress,
      userAgent: req.get("user-agent"),
      apiKey: req.gatewayKey,
    });
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({
      error: e.message || String(e),
      attempts: e.attempts || undefined,
    });
  }
});

router.get("/search", requireGatewayAuth, async (req, res) => {
  try {
    const result = await executeSearch({
      query: req.query.query || req.query.q,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      recency: req.query.recency,
      mode: req.query.mode,
      providers: providerList(req.query.providers),
      ip: req.ip || req.socket?.remoteAddress,
      userAgent: req.get("user-agent"),
      apiKey: req.gatewayKey,
    });
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({
      error: e.message || String(e),
      attempts: e.attempts || undefined,
    });
  }
});

module.exports = router;
