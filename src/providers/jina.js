const { ProviderError } = require("./errors");

/**
 * Jina Search API — https://s.jina.ai
 * @param {{ secret: string|null, baseUrl?: string|null }} account
 * @param {{ query: string, limit: number, signal?: AbortSignal }} params
 */
async function searchJina(account, params) {
  if (!account.secret) {
    throw new ProviderError("auth", "Jina account missing API key");
  }
  const limit = Math.min(Math.max(params.limit || 10, 1), 20);
  const base = (account.baseUrl || "https://s.jina.ai").replace(/\/+$/, "");
  const u = new URL(`${base}/${encodeURIComponent(params.query)}`);

  let res;
  try {
    res = await fetch(u, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${account.secret}`,
        "X-Respond-With": "no-content",
      },
      signal: params.signal,
    });
  } catch (e) {
    throw new ProviderError("network", e.message || "Jina network error");
  }

  const text = await res.text();
  if (res.status === 401 || res.status === 403) {
    throw new ProviderError("auth", `Jina auth failed (${res.status})`, {
      status: res.status,
    });
  }
  if (res.status === 429) {
    throw new ProviderError("rate_limited", "Jina rate limited", {
      status: 429,
      retryAfterSec: 60,
    });
  }
  if (!res.ok) {
    throw new ProviderError(
      "upstream",
      `Jina error ${res.status}: ${text.slice(0, 200)}`,
      { status: res.status },
    );
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ProviderError("upstream", "Jina returned non-JSON");
  }

  const items = Array.isArray(data) ? data : data.data || data.results || [];
  const results = [];
  for (const item of items) {
    const url = item.url || item.link;
    if (!url) continue;
    results.push({
      title: item.title || url,
      url,
      snippet: item.description || item.content || item.snippet || undefined,
      publishedAt: item.publishedTime || item.date || null,
    });
    if (results.length >= limit) break;
  }
  if (!results.length) {
    throw new ProviderError("empty", "Jina returned no results");
  }
  return { results, rawMeta: { provider: "jina" } };
}

async function testJina(account) {
  const out = await searchJina(account, { query: "example domain", limit: 1 });
  return { ok: true, sample: out.results[0] };
}

module.exports = { searchJina, testJina };
