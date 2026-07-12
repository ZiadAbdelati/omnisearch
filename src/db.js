const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { v4: uuid } = require("uuid");
const SCHEMA_VERSION = 2;

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
      provider TEXT NOT NULL,
      ok INTEGER NOT NULL,
      query_hash TEXT,
      result_count INTEGER DEFAULT 0,
      latency_ms INTEGER,
      error TEXT,
      mode TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
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
  }
  seedDefaults();
  return db;
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
        account_id, provider, ok, query, query_hash, result_count, latency_ms, error, mode, ip, user_agent, response_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      accountId,
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

function usageStats() {
  const day = new Date();
  day.setUTCHours(0, 0, 0, 0);
  const month = new Date(
    Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1),
  );
  const dayIso = day.toISOString();
  const monthIso = month.toISOString();

  const accounts = listAccounts();
  const perAccount = accounts.map((a) => {
    const row = getAccount(a.id);
    return {
      ...accountFromRow(row),
      usedToday: countUsage(a.id, dayIso, true),
      usedMonth: countUsage(a.id, monthIso, true),
      rpm: countRpm(a.id),
    };
  });

  const totals = getDb()
    .prepare(
      `SELECT
         SUM(CASE WHEN ok = 1 THEN 1 ELSE 0 END) AS ok,
         SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS fail,
         COUNT(*) AS total
       FROM usage_events WHERE created_at >= ?`,
    )
    .get(dayIso);

  const byProvider = getDb()
    .prepare(
      `SELECT provider,
         SUM(CASE WHEN ok = 1 THEN 1 ELSE 0 END) AS ok,
         COUNT(*) AS total
       FROM usage_events WHERE created_at >= ?
       GROUP BY provider`,
    )
    .all(dayIso);

  const recent = getDb()
    .prepare(
      `SELECT id, account_id AS accountId, provider, ok, result_count AS resultCount,
              latency_ms AS latencyMs, error, mode, query, ip, user_agent AS userAgent,
              response_json AS responseJson, created_at AS createdAt
       FROM usage_events ORDER BY id DESC LIMIT 100`,
    )
    .all();

  return {
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
  listAccounts,
  getAccount,
  insertAccount,
  updateAccount,
  deleteAccount,
  accountFromRow,
  recordUsage,
  countUsage,
  countRpm,
  usageStats,
  SCHEMA_VERSION,
};
