function withTimeout(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

function num(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function compact(parts) {
  return parts.filter(Boolean).join(" · ") || null;
}

function tavilyBase(baseUrl) {
  if (!baseUrl) return "https://api.tavily.com";
  const u = new URL(baseUrl);
  return `${u.protocol}//${u.host}`;
}

async function fetchJson(url, options = {}) {
  const timeout = withTimeout(5000);
  let res;
  try {
    res = await fetch(url, { ...options, signal: timeout.signal });
    const text = await res.text();
    let body = {};
    try { body = text ? JSON.parse(text) : {}; } catch { body = { error: text }; }
    return { ok: res.ok, status: res.status, body };
  } finally {
    timeout.done();
  }
}

async function tavilyUsage(account) {
  const base = tavilyBase(account.baseUrl).replace(/\/+$/, "");
  const r = await fetchJson(`${base}/usage`, {
    headers: { Authorization: `Bearer ${account.secret}`, Accept: "application/json" },
  });
  if (!r.ok) return { available: false, error: `Tavily usage ${r.status}` };
  const key = r.body.key || {};
  const acct = r.body.account || {};
  const used = num(key.usage ?? acct.plan_usage);
  const limit = num(key.limit ?? acct.plan_limit);
  const search = num(key.search_usage ?? acct.search_usage);
  return {
    available: true,
    label: compact([
      used != null && limit != null ? `${used}/${limit} credits` : used != null ? `${used} credits` : null,
      search != null ? `${search} search` : null,
    ]),
    raw: r.body,
  };
}

async function serpapiUsage(account) {
  const endpoint = account.baseUrl
    ? `${new URL(account.baseUrl).origin}/account.json`
    : "https://serpapi.com/account.json";
  const u = new URL(endpoint);
  u.searchParams.set("api_key", account.secret);
  const r = await fetchJson(u, { headers: { Accept: "application/json" } });
  if (!r.ok) return { available: false, error: `SerpAPI usage ${r.status}` };
  const used = num(r.body.this_month_usage);
  const left = num(r.body.total_searches_left ?? r.body.plan_searches_left);
  const limit = num(r.body.searches_per_month);
  return {
    available: true,
    label: compact([
      used != null && limit != null ? `${used}/${limit} searches` : used != null ? `${used} searches` : null,
      left != null ? `${left} left` : null,
    ]),
    raw: r.body,
  };
}

async function upstreamUsage(account) {
  if (!account?.secret) return { available: false, error: "No provider key" };
  if (account.provider === "tavily") return tavilyUsage(account);
  if (account.provider === "serpapi") return serpapiUsage(account);
  return { available: false, error: "No usage API integration" };
}

module.exports = { upstreamUsage };
