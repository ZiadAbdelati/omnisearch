const crypto = require("crypto");
const {
  listAccounts,
  getAccount,
  updateAccount,
  recordUsage,
  recordProviderQuota,
  countUsage,
  countRpm,
  getSetting,
  accountFromRow,
  countApiKeyUsage,
  recordApiKeyUsage,
} = require("./db");
const { open } = require("./crypto");
const { getProvider, ProviderError } = require("./providers");

const MODE_PREFERENCE = {
  auto: [],
  balanced: [
    "tavily",
    "brave",
    "kagi",
    "jina",
    "exa",
    "parallel",
    "serpapi",
    "bing",
    "google_pse",
    "firecrawl",
    "searxng",
  ],
  fresh: [
    "brave",
    "tavily",
    "bing",
    "serpapi",
    "kagi",
    "searxng",
    "exa",
  ],
  semantic: ["exa", "parallel", "tavily", "jina", "kagi", "brave", "searxng"],
  cheap: [
    "searxng",
    "brave",
    "jina",
    "tavily",
    "serpapi",
    "bing",
    "google_pse",
    "exa",
  ],
};

function startOfUtcDay() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

function startOfUtcMonth() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

function hashQuery(q) {
  return crypto.createHash("sha256").update(String(q)).digest("hex").slice(0, 16);
}

function isInCooldown(row) {
  if (!row.cooldown_until) return false;
  return new Date(row.cooldown_until).getTime() > Date.now();
}

function underQuota(row) {
  if (row.daily_limit != null) {
    const used = countUsage(row.id, startOfUtcDay(), true);
    if (used >= row.daily_limit) return false;
  }
  if (row.monthly_limit != null) {
    const used = countUsage(row.id, startOfUtcMonth(), true);
    if (used >= row.monthly_limit) return false;
  }
  if (row.rpm_limit != null) {
    if (countRpm(row.id) >= row.rpm_limit) return false;
  }
  return true;
}

function parseModes(row) {
  try {
    const m = JSON.parse(row.modes || "[]");
    return Array.isArray(m) ? m : [];
  } catch {
    return [];
  }
}

function modeBoost(provider, mode) {
  const pref = MODE_PREFERENCE[mode] || [];
  if (!pref.length) return 0;
  const idx = pref.indexOf(provider);
  return idx === -1 ? 50 : idx; // lower better
}

function remainingQuotaScore(row) {
  // Higher remaining → slightly preferred when priorities tie
  let score = 0;
  if (row.daily_limit != null) {
    const used = countUsage(row.id, startOfUtcDay(), true);
    score += Math.max(0, row.daily_limit - used);
  } else {
    score += 1000;
  }
  return score;
}

function pickOrderedAccounts({ mode, providersAllow }) {
  const rows = listAccounts()
    .map((a) => getAccount(a.id))
    .filter(Boolean)
    .filter((r) => r.enabled)
    .filter((r) => !isInCooldown(r))
    .filter((r) => underQuota(r))
    .filter((r) => !providersAllow || providersAllow.includes(r.provider));

  // Mode affinity: if account declares modes, require match (except auto)
  const filtered = rows.filter((r) => {
    if (!mode || mode === "auto") return true;
    const modes = parseModes(r);
    if (!modes.length) return true;
    return modes.includes(mode) || modes.includes("auto");
  });

  // Group by priority, weighted sample order within group
  const byPri = new Map();
  for (const r of filtered) {
    const list = byPri.get(r.priority) || [];
    list.push(r);
    byPri.set(r.priority, list);
  }

  const priorities = [...byPri.keys()].sort((a, b) => a - b);
  const ordered = [];

  for (const p of priorities) {
    let group = byPri.get(p);
    // sort group by mode boost then remaining quota, with weight noise
    group = [...group].sort((a, b) => {
      const ma = modeBoost(a.provider, mode || "auto");
      const mb = modeBoost(b.provider, mode || "auto");
      if (ma !== mb) return ma - mb;
      const qa = remainingQuotaScore(a);
      const qb = remainingQuotaScore(b);
      if (qa !== qb) return qb - qa;
      // weight: higher weight first with light randomness
      const wa = (a.weight || 1) * (0.85 + Math.random() * 0.3);
      const wb = (b.weight || 1) * (0.85 + Math.random() * 0.3);
      return wb - wa;
    });
    ordered.push(...group);
  }

  return ordered;
}

function materializeAccount(row) {
  let secret = null;
  try {
    secret = row.secret_enc ? open(row.secret_enc) : null;
  } catch {
    secret = null;
  }
  return {
    id: row.id,
    provider: row.provider,
    name: row.name,
    secret,
    baseUrl: row.base_url,
    priority: row.priority,
    weight: row.weight,
  };
}

function applyFailure(row, err) {
  const patch = {
    lastError: err.message || String(err),
  };
  if (err instanceof ProviderError) {
    if (err.code === "rate_limited") {
      const sec = err.retryAfterSec || 180;
      patch.cooldownUntil = new Date(Date.now() + sec * 1000).toISOString();
    } else if (err.code === "auth") {
      // short cooldown so we don't hammer bad keys
      patch.cooldownUntil = new Date(Date.now() + 300_000).toISOString();
    }
  }
  updateAccount(row.id, patch);
}

function applySuccess(row) {
  updateAccount(row.id, {
    lastError: null,
    lastOkAt: new Date().toISOString(),
    cooldownUntil: null,
  });
}

function startOfUtcDayIso() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

function startOfUtcMonthIso() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

function requireApiKeyQuota(apiKey) {
  if (!apiKey) return;
  const checks = [
    [apiKey.rpmLimit, new Date(Date.now() - 60_000).toISOString(), "per-minute"],
    [apiKey.dailyLimit, startOfUtcDayIso(), "daily"],
    [apiKey.monthlyLimit, startOfUtcMonthIso(), "monthly"],
  ];
  for (const [limit, since, label] of checks) {
    if (limit != null && countApiKeyUsage(apiKey.id, since) >= limit) {
      recordApiKeyUsage({ apiKeyId: apiKey.id, ok: false });
      const err = new Error(`API key ${label} limit exceeded`);
      err.status = 429;
      throw err;
    }
  }
}

function effectiveProviders(requested, apiKey) {
  const req = Array.isArray(requested) && requested.length ? requested.map(String) : null;
  const allowed = apiKey?.allowedProviders || [];
  if (!allowed.length) return req;
  if (!req) return allowed;
  const denied = req.filter((p) => !allowed.includes(p));
  if (denied.length) {
    const err = new Error(`API key is not allowed to use provider(s): ${denied.join(", ")}`);
    err.status = 403;
    throw err;
  }
  return req;
}

/**
 * @param {{
 *  query: string,
 *  limit?: number,
 *  recency?: string,
 *  mode?: string,
 *  providers?: string[],
 *  signal?: AbortSignal,
 *  ip?: string,
 *  userAgent?: string,
 *  apiKey?: { id: string, name?: string, tokenPreview?: string, allowedProviders?: string[], rpmLimit?: number, dailyLimit?: number, monthlyLimit?: number, maxResults?: number },
 * }} opts
 */
async function executeSearch(opts) {
  const query = String(opts.query || "").trim();
  if (!query) {
    const err = new Error("query is required");
    err.status = 400;
    throw err;
  }

  requireApiKeyQuota(opts.apiKey);
  const maxLimit = Number(getSetting("max_limit", "20")) || 20;
  const keyMaxLimit = opts.apiKey?.maxResults ?? maxLimit;
  const defaultLimit = Number(getSetting("default_limit", "10")) || 10;
  const limit = Math.min(
    Math.max(Number(opts.limit) || defaultLimit, 1),
    maxLimit,
    keyMaxLimit,
  );
  const mode = opts.mode || getSetting("default_mode", "auto") || "auto";
  const providersAllow = effectiveProviders(opts.providers, opts.apiKey);

  const candidates = pickOrderedAccounts({ mode, providersAllow });
  if (!candidates.length) {
    const err = new Error("No healthy search accounts available");
    err.status = 503;
    throw err;
  }

  const attempts = [];
  const qh = hashQuery(query);

  for (const row of candidates) {
    const provider = getProvider(row.provider);
    const account = materializeAccount(row);
    const t0 = Date.now();
    try {
      const out = await provider.search(account, {
        query,
        limit,
        recency: opts.recency,
        signal: opts.signal,
      });
      const ms = Date.now() - t0;
      recordUsage({
        accountId: row.id,
        apiKeyId: opts.apiKey?.id,
        apiKeyName: opts.apiKey?.name,
        apiKeyPreview: opts.apiKey?.tokenPreview,
        provider: row.provider,
        ok: true,
        query,
        queryHash: qh,
        resultCount: out.results.length,
        latencyMs: ms,
        mode,
        ip: opts.ip,
        userAgent: opts.userAgent,
        responseJson: JSON.stringify(out.results),
      });
      if (out.rawMeta?.providerQuota) {
        recordProviderQuota({
          accountId: row.id,
          provider: row.provider,
          quota: out.rawMeta.providerQuota,
        });
      }
      applySuccess(row);
      recordApiKeyUsage({ apiKeyId: opts.apiKey?.id, ok: true });
      attempts.push({
        accountId: row.id,
        accountName: row.name,
        provider: row.provider,
        ok: true,
        ms,
        resultCount: out.results.length,
      });
      return {
        query,
        provider: row.provider,
        accountId: row.id,
        accountName: row.name,
        tookMs: ms,
        mode,
        results: out.results,
        attempts,
      };
    } catch (e) {
      const ms = Date.now() - t0;
      const pe =
        e instanceof ProviderError
          ? e
          : new ProviderError("upstream", e.message || String(e));
      recordUsage({
        accountId: row.id,
        apiKeyId: opts.apiKey?.id,
        apiKeyName: opts.apiKey?.name,
        apiKeyPreview: opts.apiKey?.tokenPreview,
        provider: row.provider,
        ok: false,
        query,
        queryHash: qh,
        resultCount: 0,
        latencyMs: ms,
        error: `${pe.code}: ${pe.message}`,
        mode,
        ip: opts.ip,
        userAgent: opts.userAgent,
      });
      applyFailure(row, pe);
      attempts.push({
        accountId: row.id,
        accountName: row.name,
        provider: row.provider,
        ok: false,
        ms,
        error: pe.message,
        code: pe.code,
      });
    }
  }

  recordApiKeyUsage({ apiKeyId: opts.apiKey?.id, ok: false });
  const err = new Error(
    `All search providers failed: ${attempts
      .map((a) => `${a.provider}/${a.error}`)
      .join("; ")}`,
  );
  err.status = 502;
  err.attempts = attempts;
  throw err;
}

async function testAccountConfig(input) {
  const provider = getProvider(input.provider);
  if (provider.needsSecret && !input.secret && input.provider !== "searxng") {
    // allow testing existing sealed secret via id path elsewhere
  }
  const account = {
    id: input.id || "test",
    provider: input.provider,
    name: input.name || "test",
    secret: input.secret || null,
    baseUrl: input.baseUrl || null,
  };
  if (provider.needsSecret && !account.secret) {
    throw new ProviderError("auth", "API key required for this provider");
  }
  if (input.provider === "searxng" && !account.baseUrl) {
    throw new ProviderError("bad_request", "baseUrl required for searxng");
  }
  const t0 = Date.now();
  const out = await provider.test(account);
  return { ...out, ms: Date.now() - t0 };
}

module.exports = {
  executeSearch,
  testAccountConfig,
  pickOrderedAccounts,
  accountFromRow,
};
