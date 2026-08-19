#!/usr/bin/env node
// Inline credentials in an account baseUrl (http://user:pass@host) are dead
// config -- Node's fetch refuses to build a request from such a URL -- but they
// used to sit in the DB in plaintext and were echoed back by the admin API.
// New writes are rejected; legacy rows are stripped by the schema 7 migration.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omnisearch-baseurl-'));
process.env.DATABASE_PATH = path.join(tmpDir, 'gateway.db');
process.env.SECRET_KEY = 'baseurl-credentials-test-secret-key-32b';
process.env.ADMIN_TOKEN = 'baseurl-credentials-admin-token';
delete process.env.NODE_ENV;
delete process.env.OMNISEARCH_ENFORCE_SECURE;
delete process.env.SG_ENFORCE_SECURE;

const { urlHasCredentials, stripUrlCredentials } = require('../src/security');
const { initDb, getDb, insertAccount, getAccount } = require('../src/db');
const { createApp } = require('../src/app');

const ADMIN = { Authorization: `Bearer ${process.env.ADMIN_TOKEN}` };

function unit() {
  const credentialed = [
    'http://admin:hunter2@searxng:8080/',
    'https://user@host/path',
    'http://@host',
    'http://u:p@ss@host/p', // last @ delimits userinfo
    '  http://a:b@c ',
  ];
  for (const v of credentialed) {
    assert.ok(urlHasCredentials(v), `should flag credentials: ${v}`);
    assert.ok(!urlHasCredentials(stripUrlCredentials(v)), `strip should clear: ${v}`);
  }

  // An @ elsewhere in the URL is not userinfo and must survive untouched.
  const clean = [
    'http://searxng:8080',
    'https://host/a@b',
    'https://host/search?q=a@b.com',
    'searxng:8080',
    '',
  ];
  for (const v of clean) {
    assert.ok(!urlHasCredentials(v), `should not flag: ${v}`);
    assert.equal(stripUrlCredentials(v), v, `should not rewrite: ${v}`);
  }
  assert.equal(stripUrlCredentials(null), null);
  assert.equal(urlHasCredentials(null), false);
  console.log('  url helpers ok');
}

function migration() {
  initDb();
  // Simulate a legacy row written before validation existed.
  const dirty = insertAccount({
    provider: 'searxng',
    name: 'legacy-cred-url',
    baseUrl: 'http://admin:LEGACYPASSWORD@searxng:8080/',
    priority: 1,
  });
  const untouched = insertAccount({
    provider: 'searxng',
    name: 'clean-url',
    baseUrl: 'http://searxng:8080',
    priority: 2,
  });
  // Error text written before provider errors were redacted can still hold the
  // key that was sent; the same migration scrubs that history.
  getDb()
    .prepare('UPDATE accounts SET last_error = ? WHERE id = ?')
    .run('network: request to http://admin:LEGACYPASSWORD@searxng:8080/ failed', untouched.id);
  getDb()
    .prepare('INSERT INTO usage_events (account_id, provider, ok, error, created_at) VALUES (?,?,?,?,?)')
    .run(dirty.id, 'serpapi', 0, 'upstream: https://serpapi.com/search.json?api_key=LEGACYSERPKEY&q=x', new Date().toISOString());

  getDb().exec("UPDATE meta SET value = '6' WHERE key = 'schema_version'");

  initDb(); // re-run migrations

  const cleaned = getAccount(dirty.id);
  assert.equal(cleaned.base_url, 'http://searxng:8080/', 'credentials should be stripped');
  assert.ok(!cleaned.base_url.includes('LEGACYPASSWORD'), 'password must not survive');
  assert.equal(
    getAccount(untouched.id).base_url,
    'http://searxng:8080',
    'a clean baseUrl must not be rewritten',
  );
  const version = getDb().prepare("SELECT value FROM meta WHERE key = 'schema_version'").get();
  assert.equal(version.value, '7', 'schema version should advance to 7');

  const scrubbedAccount = getAccount(untouched.id).last_error;
  assert.ok(!scrubbedAccount.includes('LEGACYPASSWORD'), 'last_error should be scrubbed');
  assert.match(scrubbedAccount, /\[redacted\]/, 'last_error should carry a redaction marker');
  const scrubbedUsage = getDb().prepare('SELECT error FROM usage_events').get().error;
  assert.ok(!scrubbedUsage.includes('LEGACYSERPKEY'), 'usage_events.error should be scrubbed');

  // No plaintext credential anywhere in the accounts table afterwards.
  const all = getDb().prepare('SELECT base_url FROM accounts').all();
  assert.ok(
    !all.some((r) => r.base_url && r.base_url.includes('LEGACYPASSWORD')),
    'no row should retain the legacy password',
  );
  console.log('  schema 7 migration ok');
}

async function routes() {
  const server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (p, body) =>
    fetch(base + p, {
      method: 'POST',
      headers: { ...ADMIN, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  try {
    const create = await post('/admin/api/accounts', {
      provider: 'searxng',
      name: 'rejected',
      baseUrl: 'http://admin:REJECTME@searxng:8080/',
    });
    assert.equal(create.status, 400, 'create should reject a credentialed baseUrl');
    assert.match((await create.json()).error, /must not embed credentials/);

    const test = await post('/admin/api/accounts/test', {
      provider: 'searxng',
      name: 'rejected',
      baseUrl: 'http://admin:REJECTME@searxng:8080/',
    });
    assert.equal(test.status, 400, 'unsaved test should reject too');

    const ok = await post('/admin/api/accounts', {
      provider: 'searxng',
      name: 'accepted',
      baseUrl: 'http://searxng:8080',
    });
    assert.equal(ok.status, 201, 'a clean baseUrl should still be accepted');
    const id = (await ok.json()).account.id;

    const patch = await fetch(`${base}/admin/api/accounts/${id}`, {
      method: 'PATCH',
      headers: { ...ADMIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl: 'http://admin:REJECTME@searxng:8080/' }),
    });
    assert.equal(patch.status, 400, 'patch should reject a credentialed baseUrl');
    assert.equal(
      getAccount(id).base_url,
      'http://searxng:8080',
      'a rejected patch must leave the stored baseUrl unchanged',
    );

    // Round-trip: the edit form reads baseUrl back verbatim, so it must not be masked.
    const listed = await fetch(`${base}/admin/api/accounts`, { headers: ADMIN }).then((r) => r.json());
    const account = listed.accounts.find((a) => a.id === id);
    assert.equal(account.baseUrl, 'http://searxng:8080', 'baseUrl must round-trip unmasked');

    const body = JSON.stringify(listed);
    assert.ok(!body.includes('REJECTME'), 'no rejected credential should appear in the listing');
    console.log('  admin route validation ok');
  } finally {
    server.close();
  }
}

(async () => {
  try {
    unit();
    migration();
    await routes();
    console.log('baseUrl credential regressions ok');
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
})();
