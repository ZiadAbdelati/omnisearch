const { ProviderError } = require("./errors");

/**
 * @param {{ secret: string|null, baseUrl?: string|null }} account
 * @param {{ query: string, limit: number, recency?: string, signal?: AbortSignal }} params
 */
async function searchTavily(account, params) {
  if (!account.secret) {
    throw new ProviderError("auth", "Tavily account missing API key");
  }
  const limit = Math.min(Math.max(params.limit || 10, 1), 20);
  const endpoint = (
    account.baseUrl || "https://api.tavily.com/search"
  ).replace(/\/+$/, "");
  const body = {
    api_key: account.secret,
    query: params.query,
    max_results: limit,
    search_depth: "basic",
    include_answer: false,
  };
  if (params.recency === "day") body.time_range = "day";
  else if (params.recency === "week") body.time_range = "week";
  else if (params.recency === "month") body.time_range = "month";
  else if (params.recency === "year") body.time_range = "year";

  let res;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: params.signal,
    });
  } catch (e) {
    throw new ProviderError("network", e.message || "Tavily network error");
  }

  const text = await res.text();
  if (res.status === 401 || res.status === 403) {
    throw new ProviderError("auth", `Tavily auth failed (${res.status})`, {
      status: res.status,
    });
  }
  if (res.status === 429) {
    throw new ProviderError("rate_limited", "Tavily rate limited", {
      status: 429,
      retryAfterSec: 60,
    });
  }
  if (!res.ok) {
    throw new ProviderError(
      "upstream",
      `Tavily error ${res.status}: ${text.slice(0, 200)}`,
      { status: res.status },
    );
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ProviderError("upstream", "Tavily returned non-JSON");
  }

  const results = [];
  for (const item of data.results || []) {
    if (!item.url) continue;
    results.push({
      title: item.title || item.url,
      url: item.url,
      snippet: item.content || item.snippet || undefined,
      publishedAt: item.published_date || null,
    });
    if (results.length >= limit) break;
  }
  if (!results.length) {
    throw new ProviderError("empty", "Tavily returned no results");
  }
  return { results, rawMeta: { provider: "tavily", answer: data.answer } };
}

async function testTavily(account) {
  const out = await searchTavily(account, {
    query: "example domain",
    limit: 1,
  });
  return { ok: true, sample: out.results[0] };
}

module.exports = { searchTavily, testTavily };
