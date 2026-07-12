const { ProviderError } = require("./errors");

/**
 * Kagi Search API — https://kagi.com/api/v1/search
 */
async function searchKagi(account, params) {
  if (!account.secret) {
    throw new ProviderError("auth", "Kagi account missing API key");
  }
  const limit = Math.min(Math.max(params.limit || 10, 1), 20);
  const endpoint = (account.baseUrl || "https://kagi.com/api/v1/search").replace(
    /\/+$/,
    "",
  );

  const body = {
    query: params.query,
    limit,
  };
  if (params.recency) {
    const days =
      params.recency === "day"
        ? 1
        : params.recency === "week"
          ? 7
          : params.recency === "month"
            ? 30
            : 365;
    const after = new Date(Date.now() - days * 86400000)
      .toISOString()
      .slice(0, 10);
    body.filters = { after };
  }

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
    throw new ProviderError("network", e.message || "Kagi network error");
  }

  const text = await res.text();
  if (res.status === 401 || res.status === 403) {
    throw new ProviderError("auth", `Kagi auth failed (${res.status})`, {
      status: res.status,
    });
  }
  if (res.status === 429) {
    throw new ProviderError("rate_limited", "Kagi rate limited", {
      status: 429,
      retryAfterSec: 60,
    });
  }
  if (!res.ok) {
    throw new ProviderError(
      "upstream",
      `Kagi error ${res.status}: ${text.slice(0, 200)}`,
      { status: res.status },
    );
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ProviderError("upstream", "Kagi returned non-JSON");
  }

  const buckets = [
    ...(data.data?.search || []),
    ...(data.data?.news || []),
    ...(data.data?.video || []),
  ];
  const results = [];
  for (const item of buckets) {
    const url = item.url || item.link;
    if (!url) continue;
    results.push({
      title: item.title || url,
      url,
      snippet: item.snippet || item.description || undefined,
      publishedAt: item.published || item.date || null,
    });
    if (results.length >= limit) break;
  }
  if (!results.length) {
    throw new ProviderError("empty", "Kagi returned no results");
  }
  return { results, rawMeta: { provider: "kagi" } };
}

async function testKagi(account) {
  const out = await searchKagi(account, { query: "example domain", limit: 1 });
  return { ok: true, sample: out.results[0] };
}

module.exports = { searchKagi, testKagi };
