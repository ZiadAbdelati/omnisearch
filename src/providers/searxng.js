const { ProviderError } = require("./errors");

function mapRecency(recency) {
  if (recency === "day") return "day";
  if (recency === "week") return "month"; // SearXNG has no week
  if (recency === "month") return "month";
  if (recency === "year") return "year";
  return null;
}

/**
 * @param {{ secret: string|null, baseUrl?: string|null }} account
 * @param {{ query: string, limit: number, recency?: string, signal?: AbortSignal }} params
 */
async function searchSearxng(account, params) {
  const base = (account.baseUrl || "").replace(/\/+$/, "");
  if (!base) {
    throw new ProviderError("bad_request", "SearXNG account missing baseUrl");
  }
  const limit = Math.min(Math.max(params.limit || 10, 1), 20);
  const u = new URL(`${base}/search`);
  u.searchParams.set("q", params.query);
  u.searchParams.set("format", "json");
  const tr = mapRecency(params.recency);
  if (tr) u.searchParams.set("time_range", tr);

  const headers = { Accept: "application/json" };
  if (account.secret) {
    // optional bearer if instance is locked down
    headers.Authorization = `Bearer ${account.secret}`;
  }

  let res;
  try {
    res = await fetch(u, { headers, signal: params.signal });
  } catch (e) {
    throw new ProviderError("network", e.message || "SearXNG network error");
  }

  const text = await res.text();
  if (res.status === 401 || res.status === 403) {
    throw new ProviderError("auth", `SearXNG auth failed (${res.status})`, {
      status: res.status,
    });
  }
  if (!res.ok) {
    throw new ProviderError(
      "upstream",
      `SearXNG error ${res.status}: ${text.slice(0, 200)}`,
      { status: res.status },
    );
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ProviderError("upstream", "SearXNG returned non-JSON");
  }

  const results = [];
  for (const item of data.results || []) {
    if (!item.url) continue;
    results.push({
      title: item.title || item.url,
      url: item.url,
      snippet: item.content || undefined,
      publishedAt: item.publishedDate || item.published_date || null,
    });
    if (results.length >= limit) break;
  }
  if (!results.length) {
    const un = data.unresponsive_engines;
    const extra =
      Array.isArray(un) && un.length
        ? ` unresponsive: ${un.map((x) => (Array.isArray(x) ? x.join(":") : x)).join(", ")}`
        : "";
    throw new ProviderError("empty", `SearXNG returned no results.${extra}`);
  }
  return { results, rawMeta: { provider: "searxng" } };
}

async function testSearxng(account) {
  const out = await searchSearxng(account, {
    query: "example domain",
    limit: 1,
  });
  return { ok: true, sample: out.results[0] };
}

module.exports = { searchSearxng, testSearxng };
