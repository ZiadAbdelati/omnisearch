const { ProviderError } = require("./errors");

/**
 * SerpAPI Google results — https://serpapi.com/search.json
 * secret = api_key
 */
async function searchSerpapi(account, params) {
  if (!account.secret) {
    throw new ProviderError("auth", "SerpAPI account missing API key");
  }
  const limit = Math.min(Math.max(params.limit || 10, 1), 20);
  const endpoint = (
    account.baseUrl || "https://serpapi.com/search.json"
  ).replace(/\/+$/, "");
  const u = new URL(endpoint);
  u.searchParams.set("engine", "google");
  u.searchParams.set("q", params.query);
  u.searchParams.set("api_key", account.secret);
  u.searchParams.set("num", String(limit));
  if (params.recency === "day") u.searchParams.set("tbs", "qdr:d");
  else if (params.recency === "week") u.searchParams.set("tbs", "qdr:w");
  else if (params.recency === "month") u.searchParams.set("tbs", "qdr:m");
  else if (params.recency === "year") u.searchParams.set("tbs", "qdr:y");

  let res;
  try {
    res = await fetch(u, {
      headers: { Accept: "application/json" },
      signal: params.signal,
    });
  } catch (e) {
    throw new ProviderError("network", e.message || "SerpAPI network error");
  }

  const text = await res.text();
  if (res.status === 401 || res.status === 403) {
    throw new ProviderError("auth", `SerpAPI auth failed (${res.status})`, {
      status: res.status,
    });
  }
  if (res.status === 429) {
    throw new ProviderError("rate_limited", "SerpAPI rate limited", {
      status: 429,
      retryAfterSec: 60,
    });
  }
  if (!res.ok) {
    throw new ProviderError(
      "upstream",
      `SerpAPI error ${res.status}: ${text.slice(0, 200)}`,
      { status: res.status },
    );
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ProviderError("upstream", "SerpAPI returned non-JSON");
  }
  if (data.error) {
    throw new ProviderError("upstream", String(data.error));
  }

  const results = [];
  for (const item of data.organic_results || []) {
    if (!item.link) continue;
    results.push({
      title: item.title || item.link,
      url: item.link,
      snippet: item.snippet || undefined,
      publishedAt: item.date || null,
    });
    if (results.length >= limit) break;
  }
  if (!results.length) {
    throw new ProviderError("empty", "SerpAPI returned no results");
  }
  return { results, rawMeta: { provider: "serpapi" } };
}

async function testSerpapi(account) {
  const out = await searchSerpapi(account, {
    query: "example domain",
    limit: 1,
  });
  return { ok: true, sample: out.results[0] };
}

module.exports = { searchSerpapi, testSerpapi };
