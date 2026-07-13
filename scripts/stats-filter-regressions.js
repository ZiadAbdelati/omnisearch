#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omnisearch-stats-'));
process.env.DATABASE_PATH = path.join(tmpDir, 'gateway.db');
process.env.SECRET_KEY = 'stats-filter-test-secret-key-with-32-bytes';
process.env.ADMIN_TOKEN = 'stats-filter-admin-token';

const { initDb, getDb, usageStats, deleteApiKey, listApiKeys, rerollApiKey } = require('../src/db');

function insertUsage({ accountId, apiKeyId, provider, ok, query, resultCount = 0, latencyMs = 10, error = null, mode = 'auto', ip = null, userAgent = null, createdAt }) {
  getDb().prepare(`INSERT INTO usage_events (
    account_id, api_key_id, provider, ok, query, query_hash, result_count, latency_ms, error, mode, ip, user_agent, response_json, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    accountId,
    apiKeyId,
    provider,
    ok ? 1 : 0,
    query,
    `hash:${query}`,
    resultCount,
    latencyMs,
    error,
    mode,
    ip,
    userAgent,
    '[]',
    createdAt,
  );
}

try {
  initDb();
  const columns = getDb().prepare('PRAGMA table_info(usage_events)').all().map((c) => c.name);
  assert.ok(columns.includes('api_key_id'), 'usage_events must retain the managed API key used for each search event');

  const db = getDb();
  db.prepare(`INSERT INTO accounts (
    id, provider, name, secret_enc, base_url, priority, enabled, weight,
    monthly_limit, daily_limit, rpm_limit, cooldown_until, modes, notes,
    last_error, last_ok_at, created_at, updated_at
  ) VALUES (?, ?, ?, NULL, NULL, 1, 1, 1, NULL, NULL, NULL, NULL, '[]', NULL, NULL, NULL, ?, ?)`).run(
    'acct-brave', 'brave', 'Brave Main', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z',
  );
  db.prepare(`INSERT INTO accounts (
    id, provider, name, secret_enc, base_url, priority, enabled, weight,
    monthly_limit, daily_limit, rpm_limit, cooldown_until, modes, notes,
    last_error, last_ok_at, created_at, updated_at
  ) VALUES (?, ?, ?, NULL, NULL, 2, 1, 1, NULL, NULL, NULL, NULL, '[]', NULL, NULL, NULL, ?, ?)`).run(
    'acct-tavily', 'tavily', 'Tavily Backup', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z',
  );
  db.prepare(`INSERT INTO api_keys (
    id, name, token_hash, token_preview, enabled, allowed_providers,
    rpm_limit, daily_limit, monthly_limit, max_results, notes,
    last_used_at, created_at, updated_at
  ) VALUES (?, ?, ?, ?, 1, '[]', NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)`).run(
    'key-alpha', 'Alpha App', 'hash-alpha', 'sgk_alpha', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z',
  );
  db.prepare(`INSERT INTO api_keys (
    id, name, token_hash, token_preview, enabled, allowed_providers,
    rpm_limit, daily_limit, monthly_limit, max_results, notes,
    last_used_at, created_at, updated_at
  ) VALUES (?, ?, ?, ?, 1, '[]', NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)`).run(
    'key-beta', 'Beta Worker', 'hash-beta', 'sgk_beta', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z',
  );

  insertUsage({ accountId: 'acct-brave', apiKeyId: 'key-alpha', provider: 'brave', ok: true, query: 'alpha domain search', resultCount: 3, ip: '10.0.0.10', userAgent: 'AlphaApp/1.0', createdAt: '2026-01-02T10:00:00.000Z' });
  insertUsage({ accountId: 'acct-tavily', apiKeyId: 'key-beta', provider: 'tavily', ok: false, query: 'beta failure search', error: 'upstream: timeout', ip: '10.0.0.11', userAgent: 'BetaWorker/2.0', createdAt: '2026-01-02T11:00:00.000Z' });
  insertUsage({ accountId: 'acct-brave', apiKeyId: 'key-alpha', provider: 'brave', ok: true, query: 'older alpha search', resultCount: 1, ip: '10.0.0.10', userAgent: 'AlphaApp/1.0', createdAt: '2025-12-31T23:00:00.000Z' });
  insertUsage({ accountId: 'acct-brave', apiKeyId: null, provider: 'brave', ok: true, query: 'legacy managed search', resultCount: 2, ip: '10.0.0.12', userAgent: 'LegacyApp/1.0', createdAt: '2026-01-02T12:00:00.000Z' });

  const filtered = usageStats({
    from: '2026-01-01',
    to: '2026-01-03',
    apiKeyId: 'key-alpha',
    provider: 'brave',
    status: 'ok',
    ipOrApp: 'alphaapp',
    query: 'domain',
  });

  assert.equal(filtered.recent.length, 1, 'combined filters should return only matching events');
  assert.equal(filtered.recent[0].query, 'alpha domain search');
  assert.equal(filtered.recent[0].apiKeyId, 'key-alpha');
  assert.equal(filtered.recent[0].apiKeyName, 'Alpha App');
  assert.equal(filtered.recent[0].accountName, 'Brave Main');
  assert.deepEqual(filtered.today, { ok: 1, fail: 0, total: 1 });
  assert.deepEqual(filtered.byProvider, [{ provider: 'brave', ok: 1, total: 1 }]);
  assert.ok(filtered.filterOptions.apiKeys.some((key) => key.id === 'key-alpha' && key.name === 'Alpha App'), 'filter options should expose API key labels');
  assert.ok(filtered.filterOptions.providers.includes('brave'), 'filter options should expose providers present in usage');

  const failures = usageStats({ status: 'fail', query: 'failure' });
  assert.equal(failures.recent.length, 1, 'failure filter should find failed events by query text');
  assert.equal(failures.recent[0].ok, false);

  const unknownKey = usageStats({ apiKeyId: '__unknown', query: 'legacy' });
  assert.equal(unknownKey.recent.length, 1, 'unknown API-key filter should find legacy events without stored key identity');
  assert.equal(unknownKey.recent[0].apiKeyId, null);
  assert.ok(unknownKey.filterOptions.apiKeys.some((key) => key.id === '__unknown'), 'filter options should include a legacy/unknown API-key bucket when such events exist');

  assert.equal(deleteApiKey('key-alpha'), true, 'test setup should soft-delete the Alpha API key');
  assert.equal(listApiKeys().some((key) => key.id === 'key-alpha'), false, 'deleted API keys should leave the active key list');
  assert.equal(rerollApiKey('key-alpha'), null, 'deleted API keys should not be rerollable');
  const deletedKey = usageStats({ apiKeyId: 'key-alpha', query: 'domain' });
  assert.equal(deletedKey.recent.length, 1, 'deleted API keys should remain filterable for audit history');
  assert.equal(deletedKey.recent[0].apiKeyId, 'key-alpha');
  assert.equal(deletedKey.recent[0].apiKeyName, 'Alpha App');
  assert.equal(deletedKey.recent[0].apiKeyPreview, 'sgk_alpha');
  assert.ok(deletedKey.filterOptions.apiKeys.some((key) => key.id === 'key-alpha' && key.deleted), 'filter options should expose deleted keys that still have usage events');

  console.log('stats filter regressions ok');
} finally {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
}
