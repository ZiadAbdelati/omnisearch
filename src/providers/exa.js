const { ProviderError } = require("./errors");

/**
 * @param {{ secret: string|null, baseUrl?: string|null }} account
 * @param {{ query: string, limit: number, recency?: string, signal?: AbortSignal }} params
 */
async function searchExa(account, params) {
  if (!account.secret) {
    throw new ProviderError("auth", "Exa account missing API key");
  }
  const limit = Math.min(Math.max(params.limit || 10, 1), 20);
  const endpoint = (account.baseUrl || "https://api.exa.ai/search").replace(
    /\/+$/,
    "",
  );

  const body = {
    query: params.query,
    numResults: limit,
    type: "auto",
    contents: { text: { maxCharacters: 400 } },
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
    const start = new Date(Date.now() - days * 86400000)
      .toISOString()
      .slice(0, 10);
    body.startPublishedDate = start;
  }

  let res;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "x-api-key": account.secret,
      },
      body: JSON.stringify(body),
      signal: params.signal,
    });
  } catch (e) {
    throw new ProviderError("network", e.message || "Exa network error");
  }

  const text = await res.text();
  if (res.status === 401 || res.status === 403) {
    throw new ProviderError("auth", `Exa auth failed (${res.status})`, {
      status: res.status,
    });
  }
  if (res.status === 429) {
    throw new ProviderError("rate_limited", "Exa rate limited", {
      status: 429,
      retryAfterSec: 60,
    });
  }
  if (!res.ok) {
    throw new ProviderError(
      "upstream",
      `Exa error ${res.status}: ${text.slice(0, 200)}`,
      { status: res.status },
    );
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ProviderError("upstream", "Exa returned non-JSON");
  }

  const results = [];
  for (const item of data.results || []) {
    if (!item.url) continue;
    results.push({
      title: item.title || item.url,
      url: item.url,
      snippet:
        item.text?.slice?.(0, 400) ||
        item.highlights?.[0] ||
        item.summary ||
        undefined,
      publishedAt: item.publishedDate || null,
    });
    if (results.length >= limit) break;
  }
  if (!results.length) {
    throw new ProviderError("empty", "Exa returned no results");
  }
  return { results, rawMeta: { provider: "exa" } };
}

async function testExa(account) {
  const out = await searchExa(account, { query: "example domain", limit: 1 });
  return { ok: true, sample: out.results[0] };
}

module.exports = { searchExa, testExa };
