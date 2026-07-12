const { ProviderError } = require("./errors");

/**
 * Parallel Search API — https://api.parallel.ai/v1beta/search
 */
async function searchParallel(account, params) {
  if (!account.secret) {
    throw new ProviderError("auth", "Parallel account missing API key");
  }
  const limit = Math.min(Math.max(params.limit || 10, 1), 20);
  const endpoint = (
    account.baseUrl || "https://api.parallel.ai/v1beta/search"
  ).replace(/\/+$/, "");

  const body = {
    objective: params.query,
    search_queries: [params.query],
    mode: "fast",
    max_results: limit,
    max_chars_per_result: 1000,
  };

  let res;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "x-api-key": account.secret,
        "parallel-beta": "search-extract-2025-10-10",
      },
      body: JSON.stringify(body),
      signal: params.signal,
    });
  } catch (e) {
    throw new ProviderError("network", e.message || "Parallel network error");
  }

  const text = await res.text();
  if (res.status === 401 || res.status === 403) {
    throw new ProviderError("auth", `Parallel auth failed (${res.status})`, {
      status: res.status,
    });
  }
  if (res.status === 429) {
    throw new ProviderError("rate_limited", "Parallel rate limited", {
      status: 429,
      retryAfterSec: 60,
    });
  }
  if (!res.ok) {
    throw new ProviderError(
      "upstream",
      `Parallel error ${res.status}: ${text.slice(0, 200)}`,
      { status: res.status },
    );
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ProviderError("upstream", "Parallel returned non-JSON");
  }

  const items = data.results || data.documents || data.data || [];
  const results = [];
  for (const item of items) {
    const url = item.url || item.link;
    if (!url) continue;
    results.push({
      title: item.title || url,
      url,
      snippet: item.excerpt || item.snippet || item.text?.slice?.(0, 400),
      publishedAt: item.published_at || null,
    });
    if (results.length >= limit) break;
  }
  if (!results.length) {
    throw new ProviderError("empty", "Parallel returned no results");
  }
  return { results, rawMeta: { provider: "parallel" } };
}

async function testParallel(account) {
  const out = await searchParallel(account, {
    query: "example domain",
    limit: 1,
  });
  return { ok: true, sample: out.results[0] };
}

module.exports = { searchParallel, testParallel };
