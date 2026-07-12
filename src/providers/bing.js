const { ProviderError } = require("./errors");

/**
 * Azure Bing Web Search v7
 * secret = subscription key
 * baseUrl optional, default https://api.bing.microsoft.com/v7.0/search
 */
async function searchBing(account, params) {
  if (!account.secret) {
    throw new ProviderError("auth", "Bing account missing subscription key");
  }
  const limit = Math.min(Math.max(params.limit || 10, 1), 20);
  const endpoint = (
    account.baseUrl || "https://api.bing.microsoft.com/v7.0/search"
  ).replace(/\/+$/, "");
  const u = new URL(endpoint);
  u.searchParams.set("q", params.query);
  u.searchParams.set("count", String(limit));
  u.searchParams.set("mkt", "en-US");
  if (params.recency === "day") u.searchParams.set("freshness", "Day");
  else if (params.recency === "week") u.searchParams.set("freshness", "Week");
  else if (params.recency === "month") u.searchParams.set("freshness", "Month");

  let res;
  try {
    res = await fetch(u, {
      headers: {
        Accept: "application/json",
        "Ocp-Apim-Subscription-Key": account.secret,
      },
      signal: params.signal,
    });
  } catch (e) {
    throw new ProviderError("network", e.message || "Bing network error");
  }

  const text = await res.text();
  if (res.status === 401 || res.status === 403) {
    throw new ProviderError("auth", `Bing auth failed (${res.status})`, {
      status: res.status,
    });
  }
  if (res.status === 429) {
    throw new ProviderError("rate_limited", "Bing rate limited", {
      status: 429,
      retryAfterSec: 60,
    });
  }
  if (!res.ok) {
    throw new ProviderError(
      "upstream",
      `Bing error ${res.status}: ${text.slice(0, 200)}`,
      { status: res.status },
    );
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ProviderError("upstream", "Bing returned non-JSON");
  }

  const results = [];
  for (const item of data.webPages?.value || []) {
    if (!item.url) continue;
    results.push({
      title: item.name || item.url,
      url: item.url,
      snippet: item.snippet || undefined,
      publishedAt: item.dateLastCrawled || null,
    });
    if (results.length >= limit) break;
  }
  if (!results.length) {
    throw new ProviderError("empty", "Bing returned no results");
  }
  return { results, rawMeta: { provider: "bing" } };
}

async function testBing(account) {
  const out = await searchBing(account, { query: "example domain", limit: 1 });
  return { ok: true, sample: out.results[0] };
}

module.exports = { searchBing, testBing };
