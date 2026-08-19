const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { v4: uuid } = require("uuid");
const { config } = require("./config");
const { seal } = require("./crypto");
const { stripUrlCredentials, redactSecrets } = require("./security");
const SCHEMA_VERSION = 7;

/** @type {import('better-sqlite3').Database} */
let db;

function getDb() {
  if (!db) throw new Error("Database not initialized");
  return db;
}

function initDb() {
  const dir = path.dirname(config.databasePath);
  fs.mkdirSync(dir, { recursive: true });
  db = new Database(config.databasePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      name TEXT NOT NULL,
      secret_enc TEXT,
      base_url TEXT,
      priority INTEGER NOT NULL DEFAULT 100,
      weight REAL NOT NULL DEFAULT 1,
      enabled INTEGER NOT NULL DEFAULT 1,
      monthly_limit INTEGER,
      daily_limit INTEGER,
      rpm_limit INTEGER,
      cooldown_until TEXT,
      modes TEXT NOT NULL DEFAULT '[]',
      notes TEXT,
      last_error TEXT,
      last_ok_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS usage_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT NOT NULL,
      api_key_id TEXT,
      api_key_name TEXT,
      api_key_preview TEXT,
      provider TEXT NOT NULL,
      ok INTEGER NOT NULL,
      query_hash TEXT,
      result_count INTEGER DEFAULT 0,
      latency_ms INTEGER,
      error TEXT,
      mode TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
      FOREIGN KEY (api_key_id) REFERENCES api_keys(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_usage_account_created
      ON usage_events(account_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_accounts_provider
      ON accounts(provider);
  `);

  let curRow = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get();
  if (!curRow) {
    db.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?)").run("1");
    curRow = { value: "1" };
  }

  let currentVersion = Number(curRow.value);
  if (currentVersion < 2) {
    try { db.exec("ALTER TABLE usage_events ADD COLUMN query TEXT"); } catch {}
    try { db.exec("ALTER TABLE usage_events ADD COLUMN ip TEXT"); } catch {}
    try { db.exec("ALTER TABLE usage_events ADD COLUMN user_agent TEXT"); } catch {}
    try { db.exec("ALTER TABLE usage_events ADD COLUMN response_json TEXT"); } catch {}
    db.exec("UPDATE meta SET value = '2' WHERE key = 'schema_version'");
    currentVersion = 2;
  }
  ensureApiKeyTables();
  if (currentVersion < 3) {
    seedEnvGatewayKey();
    db.exec("UPDATE meta SET value = '3' WHERE key = 'schema_version'");
    currentVersion = 3;
  }
  ensureProviderQuotaTable();
  if (currentVersion < 4) {
    db.exec("UPDATE meta SET value = '4' WHERE key = 'schema_version'");
    currentVersion = 4;
  }
  if (currentVersion < 5) {
    try { db.exec("ALTER TABLE usage_events ADD COLUMN api_key_id TEXT"); } catch {}
    db.exec(`CREATE INDEX IF NOT EXISTS idx_usage_api_key_created ON usage_events(api_key_id, created_at)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_usage_created ON usage_events(created_at)`);
    db.exec("UPDATE meta SET value = '5' WHERE key = 'schema_version'");
    currentVersion = 5;
  }
  if (currentVersion < 6) {
    try { db.exec("ALTER TABLE api_keys ADD COLUMN deleted_at TEXT"); } catch {}
    try { db.exec("ALTER TABLE usage_events ADD COLUMN api_key_name TEXT"); } catch {}
    try { db.exec("ALTER TABLE usage_events ADD COLUMN api_key_preview TEXT"); } catch {}
    db.exec(`UPDATE usage_events
      SET api_key_name = COALESCE(api_key_name, (SELECT name FROM api_keys WHERE api_keys.id = usage_events.api_key_id)),
          api_key_preview = COALESCE(api_key_preview, (SELECT token_preview FROM api_keys WHERE api_keys.id = usage_events.api_key_id))
      WHERE api_key_id IS NOT NULL`);
    db.exec("UPDATE meta SET value = '6' WHERE key = 'schema_version'");
    currentVersion = 6;
  }
  if (currentVersion < 7) {
    // Inline credentials (http://user:pass@host) were always dead config —
    // Node's fetch refuses to build a request from such a URL — but they sat in
    // the DB in plaintext and were echoed by the admin API. Strip them.
    const rows = db
      .prepare("SELECT id, base_url FROM accounts WHERE base_url LIKE '%@%'")
      .all();
    const update = db.prepare("UPDATE accounts SET base_url = ? WHERE id = ?");
    for (const row of rows) {
      const cleaned = stripUrlCredentials(row.base_url);
      if (cleaned !== row.base_url) update.run(cleaned, row.id);
    }

    // Error text recorded before provider errors were redacted can still hold
    // the key that was sent. Scrub the stored history as well.
    const scrub = db.transaction((table, column, key) => {
      const select = db.prepare(
        `SELECT ${key} AS id, ${column} AS text FROM ${table} WHERE ${column} IS NOT NULL`,
      );
      const write = db.prepare(
        `UPDATE ${table} SET ${column} = ? WHERE ${key} = ?`,
      );
      for (const row of select.all()) {
        const cleaned = redactSecrets(row.text);
        if (cleaned !== row.text) write.run(cleaned, row.id);
      }
    });
    scrub("accounts", "last_error", "id");
    scrub("usage_events", "error", "rowid");

    db.exec("UPDATE meta SET value = '7' WHERE key = 'schema_version'");
    currentVersion = 7;
  }
  seedDefaults();
  return db;
}

function ensureApiKeyTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      token_preview TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      allowed_providers TEXT NOT NULL DEFAULT '[]',
      rpm_limit INTEGER,
      daily_limit INTEGER,
      monthly_limit INTEGER,
      max_results INTEGER,
      notes TEXT,
      last_used_at TEXT,
      deleted_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS api_key_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      api_key_id TEXT NOT NULL,
      ok INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (api_key_id) REFERENCES api_keys(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_api_keys_hash
      ON api_keys(token_hash);
    CREATE INDEX IF NOT EXISTS idx_api_key_usage_key_created
      ON api_key_usage(api_key_id, created_at);
  `);
}
function ensureProviderQuotaTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS provider_quotas (
      account_id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      quota_json TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );
  `);
}

function seedEnvGatewayKey() {
  if (!config.gatewayToken || config.gatewayToken.length < 16) return;
  if (/^(change-me|change-me-gateway-token|gateway-dev-token)$/i.test(config.gatewayToken)) return;
  const count = db.prepare("SELECT COUNT(*) AS c FROM api_keys").get().c;
  if (count > 0) return;
  insertApiKey(
    {
      name: "Default gateway key",
      enabled: true,
      notes: "Seeded from GATEWAY_API_TOKEN during migration.",
    },
    config.gatewayToken,
  );
}

function seedDefaults() {
  const count = db.prepare("SELECT COUNT(*) AS c FROM accounts").get().c;
  if (count > 0) return;

  const now = new Date().toISOString();
  if (config.defaultSearxngUrl) {
    db.prepare(
      `INSERT INTO accounts (
        id, provider, name, secret_enc, base_url, priority, weight, enabled,
        monthly_limit, daily_limit, rpm_limit, cooldown_until, modes, notes,
        last_error, last_ok_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, NULL, NULL, NULL, NULL, ?, ?, NULL, NULL, ?, ?)`,
    ).run(
      uuid(),
      "searxng",
      "searxng-local",
      null,
      config.defaultSearxngUrl.replace(/\/+$/, ""),
      200,
      1,
      JSON.stringify(["auto", "balanced", "cheap", "fresh"]),
      "Seeded from DEFAULT_SEARXNG_URL",
      now,
      now,
    );
  }

  const defaults = {
    default_mode: "auto",
    default_limit: "10",
    max_limit: "20",
    try_parallel_semantic: "false",
  };
  const ins = db.prepare(
    "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
  );
  for (const [k, v] of Object.entries(defaults)) ins.run(k, v);
}

function getSetting(key, fallback = null) {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? row.value : fallback;
}

function setSetting(key, value) {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(key, String(value));
}

function listSettings() {
  const rows = getDb().prepare("SELECT key, value FROM settings").all();
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

function normalizeProviderList(value) {
  if (typeof value === "string") {
    value = value.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return Array.isArray(value) ? [...new Set(value.map(String).filter(Boolean))] : [];
}

function normalizeOptionalNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function hashApiToken(token) {
  return crypto.createHmac("sha256", config.secretKey).update(String(token)).digest("hex");
}

function generateApiToken() {
  return `sgk_${crypto.randomBytes(32).toString("base64url")}`;
}

function tokenPreview(token) {
  const s = String(token);
  return `${s.slice(0, 6)}…${s.slice(-6)}`;
}

function apiKeyFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    tokenPreview: row.token_preview,
    enabled: !!row.enabled,
    allowedProviders: safeJsonArray(row.allowed_providers),
    rpmLimit: row.rpm_limit,
    dailyLimit: row.daily_limit,
    monthlyLimit: row.monthly_limit,
    maxResults: row.max_results,
    notes: row.notes,
    lastUsedAt: row.last_used_at,
    deletedAt: row.deleted_at,
    deleted: !!row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function listApiKeys() {
  return getDb()
    .prepare("SELECT * FROM api_keys WHERE deleted_at IS NULL ORDER BY created_at DESC")
    .all()
    .map(apiKeyFromRow);
}

function getApiKey(id) {
  const row = getDb().prepare("SELECT * FROM api_keys WHERE id = ? AND deleted_at IS NULL").get(id);
  return apiKeyFromRow(row);
}

function getApiKeyByToken(token) {
  if (!token) return null;
  const row = getDb()
    .prepare("SELECT * FROM api_keys WHERE token_hash = ? AND enabled = 1 AND deleted_at IS NULL")
    .get(hashApiToken(token));
  return apiKeyFromRow(row);
}

function insertApiKey(input, explicitToken = null) {
  const now = new Date().toISOString();
  const id = uuid();
  const token = explicitToken || generateApiToken();
  getDb()
    .prepare(
      `INSERT INTO api_keys (
        id, name, token_hash, token_preview, enabled, allowed_providers,
        rpm_limit, daily_limit, monthly_limit, max_results, notes,
        last_used_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    )
    .run(
      id,
      input.name || "Gateway key",
      hashApiToken(token),
      tokenPreview(token),
      input.enabled === false ? 0 : 1,
      JSON.stringify(normalizeProviderList(input.allowedProviders)),
      normalizeOptionalNumber(input.rpmLimit),
      normalizeOptionalNumber(input.dailyLimit),
      normalizeOptionalNumber(input.monthlyLimit),
      normalizeOptionalNumber(input.maxResults),
      input.notes || null,
      now,
      now,
    );
  return { key: getApiKey(id), token };
}

function updateApiKey(id, patch) {
  const row = getDb().prepare("SELECT * FROM api_keys WHERE id = ?").get(id);
  if (!row) return null;
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE api_keys SET
        name = ?, enabled = ?, allowed_providers = ?, rpm_limit = ?,
        daily_limit = ?, monthly_limit = ?, max_results = ?, notes = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      patch.name ?? row.name,
      patch.enabled === undefined ? row.enabled : patch.enabled ? 1 : 0,
      patch.allowedProviders === undefined
        ? row.allowed_providers
        : JSON.stringify(normalizeProviderList(patch.allowedProviders)),
      patch.rpmLimit === undefined ? row.rpm_limit : normalizeOptionalNumber(patch.rpmLimit),
      patch.dailyLimit === undefined ? row.daily_limit : normalizeOptionalNumber(patch.dailyLimit),
      patch.monthlyLimit === undefined ? row.monthly_limit : normalizeOptionalNumber(patch.monthlyLimit),
      patch.maxResults === undefined ? row.max_results : normalizeOptionalNumber(patch.maxResults),
      patch.notes === undefined ? row.notes : patch.notes || null,
      now,
      id,
    );
  return getApiKey(id);
}

function rerollApiKey(id) {
  const row = getDb().prepare("SELECT * FROM api_keys WHERE id = ? AND deleted_at IS NULL").get(id);
  if (!row) return null;
  const token = generateApiToken();
  getDb()
    .prepare("UPDATE api_keys SET token_hash = ?, token_preview = ?, updated_at = ? WHERE id = ?")
    .run(hashApiToken(token), tokenPreview(token), new Date().toISOString(), id);
  return { key: getApiKey(id), token };
}

function deleteApiKey(id) {
  const now = new Date().toISOString();
  const info = getDb()
    .prepare("UPDATE api_keys SET enabled = 0, deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL")
    .run(now, now, id);
  return info.changes > 0;
}

function countApiKeyUsage(apiKeyId, sinceIso) {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS c FROM api_key_usage WHERE api_key_id = ? AND created_at >= ?")
    .get(apiKeyId, sinceIso);
  return row.c;
}

function recordApiKeyUsage({ apiKeyId, ok }) {
  if (!apiKeyId) return;
  const now = new Date().toISOString();
  getDb()
    .prepare("INSERT INTO api_key_usage (api_key_id, ok, created_at) VALUES (?, ?, ?)")
    .run(apiKeyId, ok ? 1 : 0, now);
  getDb()
    .prepare("UPDATE api_keys SET last_used_at = ?, updated_at = ? WHERE id = ?")
    .run(now, now, apiKeyId);
}

function accountFromRow(row, { includeSecret = false, openedSecret = null } = {}) {
  if (!row) return null;
  return {
    id: row.id,
    provider: row.provider,
    name: row.name,
    baseUrl: row.base_url,
    priority: row.priority,
    weight: row.weight,
    enabled: !!row.enabled,
    monthlyLimit: row.monthly_limit,
    dailyLimit: row.daily_limit,
    rpmLimit: row.rpm_limit,
    cooldownUntil: row.cooldown_until,
    modes: safeJsonArray(row.modes),
    notes: row.notes,
    lastError: row.last_error,
    lastOkAt: row.last_ok_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    hasSecret: !!row.secret_enc,
    secretPreview: null,
    ...(includeSecret ? { secret: openedSecret } : {}),
  };
}

function safeJsonArray(s) {
  try {
    const v = JSON.parse(s || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function listAccounts() {
  return getDb()
    .prepare("SELECT * FROM accounts ORDER BY priority ASC, name ASC")
    .all()
    .map((r) => accountFromRow(r));
}

function getAccount(id) {
  const row = getDb().prepare("SELECT * FROM accounts WHERE id = ?").get(id);
  return row || null;
}

function insertAccount(input) {
  const now = new Date().toISOString();
  const id = uuid();
  getDb()
    .prepare(
      `INSERT INTO accounts (
        id, provider, name, secret_enc, base_url, priority, weight, enabled,
        monthly_limit, daily_limit, rpm_limit, cooldown_until, modes, notes,
        last_error, last_ok_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, NULL, ?, ?)`,
    )
    .run(
      id,
      input.provider,
      input.name,
      input.secret != null && input.secret !== "" ? seal(input.secret) : null,
      input.baseUrl || null,
      input.priority ?? 100,
      input.weight ?? 1,
      input.enabled === false ? 0 : 1,
      input.monthlyLimit ?? null,
      input.dailyLimit ?? null,
      input.rpmLimit ?? null,
      JSON.stringify(input.modes || []),
      input.notes || null,
      now,
      now,
    );
  return getAccount(id);
}

function updateAccount(id, patch) {
  const row = getAccount(id);
  if (!row) return null;
  const now = new Date().toISOString();
  const next = {
    name: patch.name ?? row.name,
    provider: patch.provider ?? row.provider,
    base_url: patch.baseUrl !== undefined ? patch.baseUrl : row.base_url,
    priority: patch.priority ?? row.priority,
    weight: patch.weight ?? row.weight,
    enabled:
      patch.enabled === undefined ? row.enabled : patch.enabled ? 1 : 0,
    monthly_limit:
      patch.monthlyLimit !== undefined ? patch.monthlyLimit : row.monthly_limit,
    daily_limit:
      patch.dailyLimit !== undefined ? patch.dailyLimit : row.daily_limit,
    rpm_limit: patch.rpmLimit !== undefined ? patch.rpmLimit : row.rpm_limit,
    modes:
      patch.modes !== undefined
        ? JSON.stringify(patch.modes)
        : row.modes,
    notes: patch.notes !== undefined ? patch.notes : row.notes,
    secret_enc: row.secret_enc,
    cooldown_until:
      patch.cooldownUntil !== undefined
        ? patch.cooldownUntil
        : row.cooldown_until,
    last_error:
      patch.lastError !== undefined ? patch.lastError : row.last_error,
    last_ok_at: patch.lastOkAt !== undefined ? patch.lastOkAt : row.last_ok_at,
  };
  if (patch.secret !== undefined) {
    next.secret_enc =
      patch.secret === null || patch.secret === ""
        ? null
        : seal(patch.secret);
  }
  getDb()
    .prepare(
      `UPDATE accounts SET
        provider = ?, name = ?, secret_enc = ?, base_url = ?, priority = ?,
        weight = ?, enabled = ?, monthly_limit = ?, daily_limit = ?, rpm_limit = ?,
        cooldown_until = ?, modes = ?, notes = ?, last_error = ?, last_ok_at = ?,
        updated_at = ?
       WHERE id = ?`,
    )
    .run(
      next.provider,
      next.name,
      next.secret_enc,
      next.base_url,
      next.priority,
      next.weight,
      next.enabled,
      next.monthly_limit,
      next.daily_limit,
      next.rpm_limit,
      next.cooldown_until,
      typeof next.modes === "string" ? next.modes : JSON.stringify(next.modes),
      next.notes,
      next.last_error,
      next.last_ok_at,
      now,
      id,
    );
  return getAccount(id);
}

function deleteAccount(id) {
  const info = getDb().prepare("DELETE FROM accounts WHERE id = ?").run(id);
  return info.changes > 0;
}

function recordUsage({
  accountId,
  apiKeyId,
  apiKeyName,
  apiKeyPreview,
  provider,
  ok,
  query,
  queryHash,
  resultCount,
  latencyMs,
  error,
  mode,
  ip,
  userAgent,
  responseJson,
}) {
  getDb()
    .prepare(
      `INSERT INTO usage_events (
        account_id, api_key_id, api_key_name, api_key_preview, provider, ok, query, query_hash, result_count, latency_ms, error, mode, ip, user_agent, response_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      accountId,
      apiKeyId || null,
      apiKeyName || null,
      apiKeyPreview || null,
      provider,
      ok ? 1 : 0,
      query || null,
      queryHash || null,
      resultCount ?? 0,
      latencyMs ?? null,
      error || null,
      mode || null,
      ip || null,
      userAgent || null,
      responseJson || null,
      new Date().toISOString(),
    );
}

function recordProviderQuota({ accountId, provider, quota }) {
  if (!accountId || !provider || !quota) return;
  getDb()
    .prepare(
      `INSERT INTO provider_quotas (account_id, provider, quota_json, observed_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(account_id) DO UPDATE SET
         provider = excluded.provider,
         quota_json = excluded.quota_json,
         observed_at = excluded.observed_at`,
    )
    .run(accountId, provider, JSON.stringify(quota), new Date().toISOString());
}

function getProviderQuota(accountId, provider) {
  const row = getDb()
    .prepare("SELECT quota_json, observed_at FROM provider_quotas WHERE account_id = ? AND provider = ?")
    .get(accountId, provider);
  if (!row) return null;
  try {
    return { quota: JSON.parse(row.quota_json), observedAt: row.observed_at };
  } catch {
    return null;
  }
}

function countUsage(accountId, sinceIso, okOnly = true) {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS c FROM usage_events
       WHERE account_id = ? AND created_at >= ? ${okOnly ? "AND ok = 1" : ""}`,
    )
    .get(accountId, sinceIso);
  return row.c;
}

function countRpm(accountId) {
  const since = new Date(Date.now() - 60_000).toISOString();
  return countUsage(accountId, since, false);
}

function accountUsageStats(accountId) {
  const day = new Date();
  day.setUTCHours(0, 0, 0, 0);
  const month = new Date(
    Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1),
  );
  return {
    usedToday: countUsage(accountId, day.toISOString(), true),
    usedMonth: countUsage(accountId, month.toISOString(), true),
    rpm: countRpm(accountId),
  };
}


function parseDateBoundary(value, boundary) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const date = new Date(`${raw}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) return null;
    if (boundary === "end") date.setUTCDate(date.getUTCDate() + 1);
    return date.toISOString();
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function normalizeUsageFilters(filters = {}) {
  const statusRaw = String(filters.status || "all").trim().toLowerCase();
  const status = ["ok", "success", "succeeded"].includes(statusRaw)
    ? "ok"
    : ["fail", "failed", "error"].includes(statusRaw)
      ? "fail"
      : "all";
  const limit = Math.min(Math.max(Number(filters.limit) || 100, 1), 500);
  return {
    from: parseDateBoundary(filters.from, "start"),
    to: parseDateBoundary(filters.to, "end"),
    apiKeyId: String(filters.apiKeyId || "").trim(),
    provider: String(filters.provider || "").trim(),
    status,
    ipOrApp: String(filters.ipOrApp || "").trim().slice(0, 200),
    query: String(filters.query || "").trim().slice(0, 200),
    limit,
  };
}

function usageWhere(filters) {
  const where = [];
  const params = [];
  if (filters.from) {
    where.push("u.created_at >= ?");
    params.push(filters.from);
  }
  if (filters.to) {
    where.push("u.created_at < ?");
    params.push(filters.to);
  }
  if (filters.apiKeyId === "__unknown") {
    where.push("u.api_key_id IS NULL");
  } else if (filters.apiKeyId) {
    where.push("u.api_key_id = ?");
    params.push(filters.apiKeyId);
  }
  if (filters.provider) {
    where.push("u.provider = ?");
    params.push(filters.provider);
  }
  if (filters.status === "ok") where.push("u.ok = 1");
  if (filters.status === "fail") where.push("u.ok = 0");
  if (filters.ipOrApp) {
    where.push("(LOWER(COALESCE(u.ip, '')) LIKE ? OR LOWER(COALESCE(u.user_agent, '')) LIKE ?)");
    const needle = `%${filters.ipOrApp.toLowerCase()}%`;
    params.push(needle, needle);
  }
  if (filters.query) {
    where.push("LOWER(COALESCE(u.query, '')) LIKE ?");
    params.push(`%${filters.query.toLowerCase()}%`);
  }
  return {
    clause: where.length ? `WHERE ${where.join(" AND ")}` : "",
    params,
  };
}

function usageFilterOptions() {
  const providers = getDb()
    .prepare(
      `SELECT provider FROM accounts
       UNION SELECT provider FROM usage_events
       ORDER BY provider`,
    )
    .all()
    .map((row) => row.provider)
    .filter(Boolean);

  const activeKeys = listApiKeys();
  const activeIds = new Set(activeKeys.map((key) => key.id));
  const deletedKeys = getDb()
    .prepare(
      `SELECT DISTINCT k.*
       FROM api_keys k
       JOIN usage_events u ON u.api_key_id = k.id
       WHERE k.deleted_at IS NOT NULL
       ORDER BY k.created_at DESC`,
    )
    .all()
    .map(apiKeyFromRow)
    .filter((key) => key && !activeIds.has(key.id));
  const knownIds = new Set([...activeIds, ...deletedKeys.map((key) => key.id)]);
  const orphanedKeys = getDb()
    .prepare(
      `SELECT u.api_key_id AS id,
              COALESCE(MAX(u.api_key_name), 'Deleted key') AS name,
              MAX(u.api_key_preview) AS tokenPreview
       FROM usage_events u
       LEFT JOIN api_keys k ON k.id = u.api_key_id
       WHERE u.api_key_id IS NOT NULL AND k.id IS NULL
       GROUP BY u.api_key_id
       ORDER BY MAX(u.created_at) DESC`,
    )
    .all()
    .filter((key) => key.id && !knownIds.has(key.id))
    .map((key) => ({ ...key, enabled: false, deleted: true }));
  const hasUnknownKeyEvents = getDb()
    .prepare("SELECT 1 FROM usage_events WHERE api_key_id IS NULL LIMIT 1")
    .get();

  const apiKeys = [...activeKeys, ...deletedKeys, ...orphanedKeys].map((key) => ({
    id: key.id,
    name: key.name,
    tokenPreview: key.tokenPreview,
    enabled: key.enabled,
    deleted: key.deleted,
  }));
  if (hasUnknownKeyEvents) {
    apiKeys.push({
      id: "__unknown",
      name: "Legacy / no key",
      tokenPreview: null,
      enabled: false,
      deleted: false,
      system: true,
    });
  }

  return {
    providers,
    apiKeys,
  };
}

function usageStats(rawFilters = {}) {
  const filters = normalizeUsageFilters(rawFilters);
  const { clause, params } = usageWhere(filters);

  const accounts = listAccounts();
  const perAccount = accounts.map((a) => ({
    ...a,
    ...accountUsageStats(a.id),
  }));

  const totals = getDb()
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN u.ok = 1 THEN 1 ELSE 0 END), 0) AS ok,
         COALESCE(SUM(CASE WHEN u.ok = 0 THEN 1 ELSE 0 END), 0) AS fail,
         COUNT(*) AS total
       FROM usage_events u ${clause}`,
    )
    .get(...params);

  const byProvider = getDb()
    .prepare(
      `SELECT u.provider,
         COALESCE(SUM(CASE WHEN u.ok = 1 THEN 1 ELSE 0 END), 0) AS ok,
         COUNT(*) AS total
       FROM usage_events u ${clause}
       GROUP BY u.provider
       ORDER BY total DESC, u.provider`,
    )
    .all(...params);

  const recent = getDb()
    .prepare(
      `SELECT u.id, u.account_id AS accountId, a.name AS accountName,
              u.api_key_id AS apiKeyId,
              COALESCE(u.api_key_name, k.name) AS apiKeyName,
              COALESCE(u.api_key_preview, k.token_preview) AS apiKeyPreview,
              k.deleted_at AS apiKeyDeletedAt,
              u.provider, u.ok, u.result_count AS resultCount,
              u.latency_ms AS latencyMs, u.error, u.mode, u.query, u.ip, u.user_agent AS userAgent,
              u.response_json AS responseJson, u.created_at AS createdAt
       FROM usage_events u
       LEFT JOIN accounts a ON a.id = u.account_id
       LEFT JOIN api_keys k ON k.id = u.api_key_id
       ${clause}
       ORDER BY u.id DESC LIMIT ?`,
    )
    .all(...params, filters.limit)
    .map((event) => ({ ...event, ok: !!event.ok }));

  return {
    filters,
    filterOptions: usageFilterOptions(),
    today: totals,
    byProvider,
    accounts: perAccount,
    recent,
  };
}

module.exports = {
  initDb,
  getDb,
  getSetting,
  setSetting,
  listSettings,
  listApiKeys,
  getApiKey,
  getApiKeyByToken,
  insertApiKey,
  updateApiKey,
  rerollApiKey,
  deleteApiKey,
  countApiKeyUsage,
  recordApiKeyUsage,
  listAccounts,
  getAccount,
  insertAccount,
  updateAccount,
  deleteAccount,
  accountFromRow,
  recordUsage,
  recordProviderQuota,
  getProviderQuota,
  countUsage,
  countRpm,
  accountUsageStats,
  usageStats,
  SCHEMA_VERSION,
};
