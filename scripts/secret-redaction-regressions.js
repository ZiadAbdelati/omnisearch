#!/usr/bin/env node
const assert = require('node:assert/strict');

process.env.SECRET_KEY = 'redaction-test-secret-key-with-32-bytes';
process.env.ADMIN_TOKEN = 'redaction-admin-token';

const { redactSecrets, errorPayload, sanitizeErrorMessage } = require('../src/security');

// Upstream error text reaches clients and the usage log. Providers that put the
// key in the request URL, or echo it back in an error body, must not leak it.
const cases = [
  {
    what: 'SerpAPI request URL (api_key query parameter)',
    input: 'SerpAPI error 401: https://serpapi.com/search.json?engine=google&api_key=abc123SECRETdef&q=hi',
    leaks: 'abc123SECRETdef',
  },
  {
    what: 'Google PSE request URL (key query parameter)',
    input: 'fetch failed: https://www.googleapis.com/customsearch/v1?key=AIzaSyA1234567890abcdefghijklmnopqrstuv&cx=abc',
    leaks: 'AIzaSyA1234567890abcdefghijklmnopqrstuv',
  },
  {
    what: 'SearXNG baseUrl with embedded basic credentials',
    input: 'request to http://admin:hunter2@searxng:8080/search?q=x failed',
    leaks: 'hunter2',
  },
  {
    what: 'Tavily key echoed in an error body',
    input: 'Tavily error 401: {"detail":"invalid key tvly-ABCdef1234567890"}',
    leaks: 'tvly-ABCdef1234567890',
  },
  {
    what: 'Brave subscription token echoed upstream',
    input: 'Brave error 422: bad token BSAabcdef1234567890xyz',
    leaks: 'BSAabcdef1234567890xyz',
  },
  {
    what: 'Authorization header quoted in an error',
    input: 'upstream rejected Authorization: Bearer sk-live-abcdefghijklmnopqrstuvwxyz',
    leaks: 'sk-live-abcdefghijklmnopqrstuvwxyz',
  },
  {
    what: 'Azure subscription header quoted in an error',
    input: 'Bing 401: Ocp-Apim-Subscription-Key=9f8e7d6c5b4a3210',
    leaks: '9f8e7d6c5b4a3210',
  },
];

for (const { what, input, leaks } of cases) {
  const out = redactSecrets(input);
  assert.ok(!out.includes(leaks), `${what}: secret survived redaction → ${out}`);
  assert.ok(out.includes('[redacted]'), `${what}: no redaction marker → ${out}`);
}

// Ordinary diagnostic text must survive so failures stay debuggable.
const benign = 'Brave error 503: upstream unavailable after 2 attempts (took 431ms)';
assert.equal(redactSecrets(benign), benign, 'benign error text should pass through untouched');
assert.equal(redactSecrets(null), null, 'null passes through');
assert.equal(redactSecrets(undefined), undefined, 'undefined passes through');

// errorPayload must redact the top-level message *and* every attempt entry,
// since a failed search returns one attempt per account tried.
const err = new Error('All search providers failed: serpapi/upstream: https://serpapi.com/search.json?api_key=TOPLEVELKEY');
err.attempts = [
  { provider: 'serpapi', ok: false, error: 'upstream: https://serpapi.com/search.json?api_key=ATTEMPTKEY' },
  { provider: 'searxng', ok: false, error: 'request to http://user:ATTEMPTPASS@searxng:8080 failed' },
  { provider: 'brave', ok: false, error: 'rate limited' },
];

const payload = errorPayload(err);
const serialized = JSON.stringify(payload);
for (const secret of ['TOPLEVELKEY', 'ATTEMPTKEY', 'ATTEMPTPASS']) {
  assert.ok(!serialized.includes(secret), `errorPayload leaked ${secret} → ${serialized}`);
}
assert.equal(payload.attempts.length, 3, 'every attempt should be preserved');
assert.equal(payload.attempts[2].error, 'rate limited', 'clean attempt text should be unchanged');
assert.equal(payload.attempts[0].provider, 'serpapi', 'non-error attempt fields should be preserved');

assert.equal(errorPayload(new Error('boom')).attempts, undefined, 'errors without attempts omit the field');
assert.equal(sanitizeErrorMessage({ message: 'Bearer abcdefghijklmnopqrstuvwx' }), 'Bearer [redacted]');
assert.equal(sanitizeErrorMessage({}), 'Internal error', 'messageless errors get a generic string');

console.log('secret redaction regressions ok');
