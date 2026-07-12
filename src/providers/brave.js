const { ProviderError } = require("./errors");

const DEFAULT_URL = "https://api.search.brave.com/res/v1/web/search";

function mapRecency(recency) {
  if (recency === "day") return "pd";
  if (recency === "week") return "pw";
  if (recency === "month") return "pm";
  if (recency === "year") return "py";
  return null;
}

function resolveUrl(baseUrl) {
  if (!baseUrl) return DEFAULT_URL;
  const b = baseUrl.replace(/\/+$/, "");
  if (/\/res\/v1\/web\/search$/i.test(b) || /web\/search$/i.test(b)) return b;
  return `${b}/res/v1/web/search`;
}

function headerNumbers(headers, name) {
  const value = headers.get(name);
  if (!value) return [];
  return value.split(",").map((part) => {
    const n = Number(part.trim());
    return Number.isFinite(n) && n >= 0 ? n : null;
  });
}

function ratePolicies(headers) {
  const value = headers.get("x-ratelimit-policy");
  if (!value) return [];
  return value.split(",").map((part) => {
    const match = part.trim().match(/^(\d+)\s*;\s*w=(\d+)$/i);
    return match ? { limit: Number(match[1]), windowSeconds: Number(match[2]) } : null;
  });
}

function braveQuotaFromHeaders(headers) {
  const policies = ratePolicies(headers);
  const limits = headerNumbers(headers, "x-ratelimit-limit");
  const remaining = headerNumbers(headers, "x-ratelimit-remaining");
  const resets = headerNumbers(headers, "x-ratelimit-reset");
  const index = policies.reduce(
    (best, policy, i) =>
      policy && policy.windowSeconds > (policies[best]?.windowSeconds || 0) ? i : best,
    -1,
  );
  if (index < 0 || policies[index].windowSeconds < 86_400) return null;
  if (limits[index] == null || remaining[index] == null) return null;
  const limit = limits[index];
  return {
    windowSeconds: policies[index].windowSeconds,
    limit: limit || null,
    remaining: limit ? Math.min(remaining[index], limit) : null,
    used: limit ? Math.max(0, limit - remaining[index]) : null,
    resetSeconds: resets[index] ?? null,
    unlimited: limit === 0,
  };
}

/**
 * @param {{ secret: string|null, baseUrl?: string|null }} account
 * @param {{ query: string, limit: number, recency?: string, signal?: AbortSignal }} params
 */
async function searchBrave(account, params) {
  if (!account.secret) {
    throw new ProviderError("auth", "Brave account missing API key");
  }
  const limit = Math.min(Math.max(params.limit || 10, 1), 20);
  const u = new URL(resolveUrl(account.baseUrl));
  u.searchParams.set("q", params.query);
  u.searchParams.set("count", String(limit));
  const freshness = mapRecency(params.recency);
  if (freshness) u.searchParams.set("freshness", freshness);

  let res;
  try {
    res = await fetch(u, {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": account.secret,
      },
      signal: params.signal,
    });
  } catch (e) {
    throw new ProviderError("network", e.message || "Brave network error");
  }

  const text = await res.text();
  if (res.status === 401 || res.status === 403) {
    throw new ProviderError("auth", `Brave auth failed (${res.status})`, {
      status: res.status,
    });
  }
  if (res.status === 429) {
    const ra = Number(res.headers.get("retry-after") || 60);
    throw new ProviderError("rate_limited", "Brave rate limited", {
      status: 429,
      retryAfterSec: Number.isFinite(ra) ? ra : 60,
    });
  }
  if (!res.ok) {
    throw new ProviderError(
      "upstream",
      `Brave error ${res.status}: ${text.slice(0, 200)}`,
      { status: res.status },
    );
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ProviderError("upstream", "Brave returned non-JSON");
  }

  const results = [];
  for (const item of data.web?.results || []) {
    if (!item.url) continue;
    results.push({
      title: item.title || item.url,
      url: item.url,
      snippet: item.description || item.extra_snippets?.[0] || undefined,
      publishedAt: item.page_age || item.age || null,
    });
    if (results.length >= limit) break;
  }
  if (!results.length) {
    throw new ProviderError("empty", "Brave returned no results");
  }
  return {
    results,
    rawMeta: { provider: "brave", providerQuota: braveQuotaFromHeaders(res.headers) },
  };
}

async function testBrave(account) {
  const out = await searchBrave(account, {
    query: "example domain",
    limit: 1,
  });
  return { ok: true, sample: out.results[0], providerQuota: out.rawMeta.providerQuota };
}

module.exports = { searchBrave, testBrave, braveQuotaFromHeaders };
