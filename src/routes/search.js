const express = require("express");
const { requireGatewayAuth } = require("../auth");
const { executeSearch } = require("../router");

const router = express.Router();
function providerList(value) {
  if (Array.isArray(value)) return value.map(String).map((s) => s.trim()).filter(Boolean);
  if (value == null || value === "") return undefined;
  return String(value).split(",").map((s) => s.trim()).filter(Boolean);
}


function searxngResults(result) {
  return {
    query: result.query,
    number_of_results: result.results.length,
    results: result.results.map((item, index) => ({
      title: item.title,
      url: item.url,
      content: item.snippet || "",
      engine: result.provider,
      score: result.results.length - index,
      category: "general",
    })),
  };
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
  const searxngFormat = String(req.query.format || "").toLowerCase() === "json";
  try {
    const result = await executeSearch({
      query: req.query.query || req.query.q,
      limit: Number(req.query.limit || req.query.count) || undefined,
      recency: req.query.recency || req.query.time_range,
      mode: req.query.mode,
      providers: providerList(req.query.providers),
      ip: req.ip || req.socket?.remoteAddress,
      userAgent: req.get("user-agent"),
      apiKey: req.gatewayKey,
    });
    res.json(searxngFormat ? searxngResults(result) : result);
  } catch (e) {
    res.status(e.status || 500).json({
      error: e.message || String(e),
      attempts: e.attempts || undefined,
    });
  }
});


module.exports = router;
