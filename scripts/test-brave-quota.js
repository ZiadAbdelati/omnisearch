const assert = require("assert/strict");
const { braveQuotaFromHeaders } = require("../src/providers/brave");

function headers(values) {
  return new Headers(values);
}

const monthly = braveQuotaFromHeaders(
  headers({
    "X-RateLimit-Limit": "50, 15000",
    "X-RateLimit-Policy": "50;w=1, 15000;w=2592000",
    "X-RateLimit-Remaining": "49, 12437",
    "X-RateLimit-Reset": "1, 1419704",
  }),
);
assert.deepEqual(monthly, {
  windowSeconds: 2592000,
  limit: 15000,
  remaining: 12437,
  used: 2563,
  resetSeconds: 1419704,
  unlimited: false,
});

const unlimited = braveQuotaFromHeaders(
  headers({
    "X-RateLimit-Limit": "1, 0",
    "X-RateLimit-Policy": "1;w=1, 0;w=2592000",
    "X-RateLimit-Remaining": "0, 0",
    "X-RateLimit-Reset": "1, 2592000",
  }),
);
assert.deepEqual(unlimited, {
  windowSeconds: 2592000,
  limit: null,
  remaining: null,
  used: null,
  resetSeconds: 2592000,
  unlimited: true,
});

assert.equal(braveQuotaFromHeaders(headers({})), null);
assert.equal(
  braveQuotaFromHeaders(
    headers({
      "X-RateLimit-Limit": "50",
      "X-RateLimit-Policy": "50;w=1",
      "X-RateLimit-Remaining": "49",
    }),
  ),
  null,
);

console.log("brave quota header parsing ok");
