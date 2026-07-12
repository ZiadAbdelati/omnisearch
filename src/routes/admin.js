const express = require("express");
const { requireAdminAuth } = require("../auth");
const { config } = require("../config");
const { open, redactSecret } = require("../crypto");
const {
  listAccounts,
  getAccount,
  insertAccount,
  updateAccount,
  deleteAccount,
  accountFromRow,
  usageStats,
  listSettings,
  setSetting,
  getSetting,
  listApiKeys,
  getApiKey,
  insertApiKey,
  updateApiKey,
  rerollApiKey,
  deleteApiKey,
} = require("../db");
const { testAccountConfig } = require("../router");
const { PROVIDERS, ProviderError } = require("../providers");

const router = express.Router();

router.use(requireAdminAuth);

function publicAccount(row) {
  const a = accountFromRow(row);
  if (row.secret_enc) {
    try {
      a.secretPreview = redactSecret(open(row.secret_enc));
    } catch {
      a.secretPreview = "(decrypt error)";
    }
  }
  return a;
}


function keyPatch(body = {}) {
  return {
    name: body.name,
    enabled: body.enabled,
    allowedProviders: body.allowedProviders,
    rpmLimit: body.rpmLimit,
    dailyLimit: body.dailyLimit,
    monthlyLimit: body.monthlyLimit,
    maxResults: body.maxResults,
    notes: body.notes,
  };
}

function validateProviders(providers) {
  if (providers === undefined) return null;
  if (!Array.isArray(providers)) return "allowedProviders must be an array";
  const bad = providers.filter((p) => !PROVIDERS[p]);
  return bad.length ? `Invalid provider(s): ${bad.join(", ")}` : null;
}
router.get("/health", (_req, res) => {
  res.json({
    ok: true,
    providers: Object.keys(PROVIDERS),
    modes: config.modes,
  });
});

router.get("/accounts", (_req, res) => {
  const rows = listAccounts().map((a) => getAccount(a.id));
  res.json({ accounts: rows.map(publicAccount) });
});

router.post("/accounts", (req, res) => {
  try {
    const b = req.body || {};
    if (!b.provider || !PROVIDERS[b.provider]) {
      return res.status(400).json({ error: "Invalid provider" });
    }
    if (!b.name) return res.status(400).json({ error: "name required" });
    if (PROVIDERS[b.provider].needsSecret && !b.secret) {
      return res.status(400).json({ error: "secret (API key) required" });
    }
    if (b.provider === "searxng" && !b.baseUrl) {
      return res.status(400).json({ error: "baseUrl required for searxng" });
    }
    const row = insertAccount({
      provider: b.provider,
      name: b.name,
      secret: b.secret,
      baseUrl: b.baseUrl,
      priority: b.priority,
      weight: b.weight,
      enabled: b.enabled,
      monthlyLimit: b.monthlyLimit,
      dailyLimit: b.dailyLimit,
      rpmLimit: b.rpmLimit,
      modes: b.modes,
      notes: b.notes,
    });
    res.status(201).json({ account: publicAccount(row) });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

router.patch("/accounts/:id", (req, res) => {
  try {
    const row = getAccount(req.params.id);
    if (!row) return res.status(404).json({ error: "Not found" });
    const b = req.body || {};
    const updated = updateAccount(req.params.id, {
      provider: b.provider,
      name: b.name,
      secret: b.secret,
      baseUrl: b.baseUrl,
      priority: b.priority,
      weight: b.weight,
      enabled: b.enabled,
      monthlyLimit: b.monthlyLimit,
      dailyLimit: b.dailyLimit,
      rpmLimit: b.rpmLimit,
      modes: b.modes,
      notes: b.notes,
      cooldownUntil: b.clearCooldown ? null : b.cooldownUntil,
      lastError: b.clearError ? null : undefined,
    });
    res.json({ account: publicAccount(updated) });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

router.delete("/accounts/:id", (req, res) => {
  const ok = deleteAccount(req.params.id);
  if (!ok) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
});

router.post("/accounts/:id/test", async (req, res) => {
  try {
    const row = getAccount(req.params.id);
    if (!row) return res.status(404).json({ error: "Not found" });
    let secret = null;
    try {
      secret = row.secret_enc ? open(row.secret_enc) : null;
    } catch {
      return res.status(500).json({ error: "Failed to decrypt secret" });
    }
    const result = await testAccountConfig({
      id: row.id,
      provider: row.provider,
      name: row.name,
      secret,
      baseUrl: row.base_url,
    });
    try {
      updateAccount(row.id, {
        lastOkAt: new Date().toISOString(),
        lastError: null,
        cooldownUntil: null,
      });
    } catch (dbErr) {
      console.error("[warn] updateAccount after test:", dbErr.message);
    }
    res.json(result);
  } catch (e) {
    const msg = e.message || String(e);
    try {
      const row = getAccount(req.params.id);
      if (row) updateAccount(row.id, { lastError: msg });
    } catch {
      /* ignore db write failures */
    }
    res.status(400).json({
      ok: false,
      error: msg,
      code: e.code,
    });
  }
});

router.post("/accounts/test", async (req, res) => {
  try {
    const b = req.body || {};
    const result = await testAccountConfig({
      provider: b.provider,
      name: b.name,
      secret: b.secret,
      baseUrl: b.baseUrl,
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({
      ok: false,
      error: e.message || String(e),
      code: e.code,
    });
  }
});

router.get("/api-keys", (_req, res) => {
  res.json({ keys: listApiKeys() });
});

router.post("/api-keys", (req, res) => {
  try {
    const b = req.body || {};
    if (!b.name) return res.status(400).json({ error: "name required" });
    const providerError = validateProviders(b.allowedProviders);
    if (providerError) return res.status(400).json({ error: providerError });
    const result = insertApiKey(keyPatch(b));
    res.status(201).json(result);
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

router.patch("/api-keys/:id", (req, res) => {
  try {
    if (!getApiKey(req.params.id)) return res.status(404).json({ error: "Not found" });
    const providerError = validateProviders(req.body?.allowedProviders);
    if (providerError) return res.status(400).json({ error: providerError });
    const key = updateApiKey(req.params.id, keyPatch(req.body || {}));
    res.json({ key });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

router.post("/api-keys/:id/reroll", (req, res) => {
  try {
    const result = rerollApiKey(req.params.id);
    if (!result) return res.status(404).json({ error: "Not found" });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

router.delete("/api-keys/:id", (req, res) => {
  const ok = deleteApiKey(req.params.id);
  if (!ok) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
});

router.get("/stats", (_req, res) => {
  res.json(usageStats());
});

router.get("/settings", (_req, res) => {
  res.json({
    settings: listSettings(),
    providers: Object.keys(PROVIDERS),
    modes: config.modes,
  });
});

router.put("/settings", (req, res) => {
  const b = req.body || {};
  const allowed = new Set([
    "default_mode",
    "default_limit",
    "max_limit",
    "try_parallel_semantic",
  ]);
  for (const [k, v] of Object.entries(b)) {
    if (allowed.has(k)) setSetting(k, v);
  }
  res.json({ settings: listSettings() });
});
router.get("/meta", (_req, res) => {
  res.json({
    providers: Object.entries(PROVIDERS).map(([id, p]) => ({
      id,
      label: p.label || id,
      needsSecret: p.needsSecret,
      secretHint: p.secretHint || null,
    })),
    modes: config.modes,
    defaultMode: getSetting("default_mode", "auto"),
  });
});
module.exports = router;
