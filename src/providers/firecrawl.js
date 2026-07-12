const { ProviderError } = require("./errors");

/**
 * Firecrawl Search — https://api.firecrawl.dev/v2/search
 */
async function searchFirecrawl(account, params) {
  if (!account.secret) {
    throw new ProviderError("auth", "Firecrawl account missing API key");
  }
  const limit = Math.min(Math.max(params.limit || 10, 1), 20);
  const endpoint = (
    account.baseUrl || "https://api.firecrawl.dev/v2/search"
  ).replace(/\/+$/, "");

  const body = {
    query: params.query,
    limit,
    sources: [{ type: "web" }],
  };

  let res;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${account.secret}`,
      },
      body: JSON.stringify(body),
      signal: params.signal,
    });
  } catch (e) {
    throw new ProviderError("network", e.message || "Firecrawl network error");
  }

  const text = await res.text();
  if (res.status === 401 || res.status === 403) {
    throw new ProviderError("auth", `Firecrawl auth failed (${res.status})`, {
      status: res.status,
    });
  }
  if (res.status === 429) {
    throw new ProviderError("rate_limited", "Firecrawl rate limited", {
      status: 429,
      retryAfterSec: 60,
    });
  }
  if (!res.ok) {
    throw new ProviderError(
      "upstream",
      `Firecrawl error ${res.status}: ${text.slice(0, 200)}`,
      { status: res.status },
    );
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ProviderError("upstream", "Firecrawl returned non-JSON");
  }

  const items =
    data.data?.web || data.data || data.results || data.web || [];
  const list = Array.isArray(items) ? items : [];
  const results = [];
  for (const item of list) {
    const url = item.url || item.metadata?.sourceURL;
    if (!url) continue;
    results.push({
      title: item.title || item.metadata?.title || url,
      url,
      snippet:
        item.description ||
        item.markdown?.slice?.(0, 400) ||
        item.metadata?.description ||
        undefined,
      publishedAt: null,
    });
    if (results.length >= limit) break;
  }
  if (!results.length) {
    throw new ProviderError("empty", "Firecrawl returned no results");
  }
  return { results, rawMeta: { provider: "firecrawl" } };
}

async function testFirecrawl(account) {
  const out = await searchFirecrawl(account, {
    query: "example domain",
    limit: 1,
  });
  return { ok: true, sample: out.results[0] };
}

module.exports = { searchFirecrawl, testFirecrawl };
