const { ProviderError } = require("./errors");

/**
 * Google Programmable Search (Custom Search JSON API)
 * secret format: "API_KEY" or "API_KEY:CX"
 * If only API_KEY, baseUrl query or notes won't work — require CX in secret as key:cx
 * Prefer secret = "KEY:CX"
 */
function parseSecret(secret) {
  const s = String(secret || "");
  const idx = s.indexOf(":");
  if (idx === -1) return { key: s, cx: null };
  // Google API keys often contain no colon; CX is the second part
  // Format KEY:CX — but API keys can have other forms. Use last colon split for cx if starts with key
  const key = s.slice(0, idx);
  const cx = s.slice(idx + 1);
  return { key, cx: cx || null };
}

async function searchGooglePse(account, params) {
  if (!account.secret) {
    throw new ProviderError(
      "auth",
      "Google PSE requires secret as API_KEY:CX (engine id)",
    );
  }
  const { key, cx } = parseSecret(account.secret);
  if (!key || !cx) {
    throw new ProviderError(
      "auth",
      "Google PSE secret must be 'API_KEY:CX' (colon-separated)",
    );
  }
  const limit = Math.min(Math.max(params.limit || 10, 1), 10);
  const endpoint = (
    account.baseUrl || "https://www.googleapis.com/customsearch/v1"
  ).replace(/\/+$/, "");
  const u = new URL(endpoint);
  u.searchParams.set("key", key);
  u.searchParams.set("cx", cx);
  u.searchParams.set("q", params.query);
  u.searchParams.set("num", String(limit));
  if (params.recency === "day") u.searchParams.set("dateRestrict", "d1");
  else if (params.recency === "week") u.searchParams.set("dateRestrict", "w1");
  else if (params.recency === "month") u.searchParams.set("dateRestrict", "m1");
  else if (params.recency === "year") u.searchParams.set("dateRestrict", "y1");

  let res;
  try {
    res = await fetch(u, {
      headers: { Accept: "application/json" },
      signal: params.signal,
    });
  } catch (e) {
    throw new ProviderError("network", e.message || "Google PSE network error");
  }

  const text = await res.text();
  if (res.status === 401 || res.status === 403) {
    throw new ProviderError("auth", `Google PSE auth failed (${res.status})`, {
      status: res.status,
    });
  }
  if (res.status === 429) {
    throw new ProviderError("rate_limited", "Google PSE rate limited", {
      status: 429,
      retryAfterSec: 60,
    });
  }
  if (!res.ok) {
    throw new ProviderError(
      "upstream",
      `Google PSE error ${res.status}: ${text.slice(0, 200)}`,
      { status: res.status },
    );
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ProviderError("upstream", "Google PSE returned non-JSON");
  }

  const results = [];
  for (const item of data.items || []) {
    if (!item.link) continue;
    results.push({
      title: item.title || item.link,
      url: item.link,
      snippet: item.snippet || undefined,
      publishedAt: null,
    });
    if (results.length >= limit) break;
  }
  if (!results.length) {
    throw new ProviderError("empty", "Google PSE returned no results");
  }
  return { results, rawMeta: { provider: "google_pse" } };
}

async function testGooglePse(account) {
  const out = await searchGooglePse(account, {
    query: "example domain",
    limit: 1,
  });
  return { ok: true, sample: out.results[0] };
}

module.exports = { searchGooglePse, testGooglePse };
