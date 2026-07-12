# Search Gateway

Self-hosted **multi-provider web search proxy** with admin UI, API-key accounts, quotas, priority, failover, and light intelligent routing.

## Purpose

Expose **one lab endpoint** for search used by OMP, Claude, scripts, and other agents:

```text
POST /v1/search   →  Tavily / Brave / Exa / SearXNG (ordered failover)
GET  /            →  Admin UI (manage accounts, priorities, limits, test keys)
```

This is **not** an LLM proxy (not OmniRoute). It only aggregates **search APIs** and **SearXNG**.

## Stack

| Layer | Choice |
|---|---|
| Runtime | Node 20+ |
| HTTP | Express |
| DB | SQLite (`better-sqlite3`) under `data/gateway.db` |
| UI | Static SPA in `public/` (no build step) |
| Deploy | `docker compose` (Dockerfile included) |

## Layout

```text
search-gateway/
  AGENTS.md           ← this file
  package.json
  Dockerfile
  docker-compose.yml
  .env.example
  src/
    index.js          ← process entry
    app.js            ← express app
    config.js         ← env
    db.js             ← schema + migrations
    crypto.js         ← secret seal/open (AES-GCM)
    auth.js           ← admin + public bearer auth
    router.js         ← priority + failover + routing
    providers/
      index.js
      brave.js
      tavily.js
      exa.js
      searxng.js
    routes/
      search.js       ← public search API
      admin.js        ← CRUD + test + stats
  public/             ← admin UI
  data/               ← runtime DB (gitignored)
  scripts/
    smoke.js          ← local smoke test
```

## Contracts

### Public search

```http
POST /v1/search
Authorization: Bearer <MANAGED_SEARCH_KEY>
Content-Type: application/json

{
  "query": "string",
  "limit": 10,
  "recency": "day|week|month|year",
  "providers": ["tavily","brave"],
  "mode": "auto|balanced|fresh|semantic|cheap"
}
```

Response:

```json
{
  "query": "...",
  "provider": "tavily",
  "accountId": "uuid",
  "accountName": "tavily-main",
  "tookMs": 123,
  "results": [
    { "title": "...", "url": "https://...", "snippet": "...", "publishedAt": null }
  ],
  "attempts": [
    { "accountId": "...", "provider": "brave", "ok": false, "error": "rate_limited", "ms": 40 }
  ]
}
```

Also accepted: `GET /v1/search?q=...&limit=10` with the same bearer token.

### Admin API

All under `/admin/api/*`, header `Authorization: Bearer <ADMIN_TOKEN>` (or cookie after UI login).

| Method | Path | Purpose |
|---|---|---|
| GET | `/admin/api/health` | Process health |
| GET | `/admin/api/accounts` | List accounts (secrets redacted) |
| POST | `/admin/api/accounts` | Create account |
| PATCH | `/admin/api/accounts/:id` | Update |
| DELETE | `/admin/api/accounts/:id` | Delete |
| POST | `/admin/api/accounts/:id/test` | Live credential test |
| POST | `/admin/api/accounts/test` | Test body without saving |
| GET | `/admin/api/stats` | Usage aggregates |
| GET | `/admin/api/settings` | Global settings |
| PUT | `/admin/api/settings` | Update settings |

### Account model

| Field | Meaning |
|---|---|
| `provider` | `brave` `tavily` `exa` `searxng` `jina` `kagi` `firecrawl` `serpapi` `bing` `google_pse` `parallel` |
| `name` | Human label |
| `secret` | API key (encrypted at rest); optional for searxng |
| `baseUrl` | Override endpoint (SearXNG base, custom proxies) |
| `priority` | Lower number = tried first (within routing) |
| `enabled` | Soft disable |
| `weight` | For weighted choice among same-priority healthy accounts |
| `monthlyLimit` | Max successful searches per UTC month (`null` = unlimited) |
| `dailyLimit` | Max successful searches per UTC day |
| `rpmLimit` | Soft requests-per-minute cap |
| `cooldownUntil` | Auto-set after hard failures / 429 |
| `modes` | JSON list of modes this account is good for (routing hint) |

Multiple accounts **of the same provider** are supported (several Brave keys, etc.).

### Routing

1. Filter `enabled` and not in cooldown and under quota.  
2. Optional `providers` allow-list and `mode` affinity.  
3. Sort by **priority ASC**, then **weight** (weighted random among same priority), then least used today.  
4. Try until one returns ≥1 result or list exhausted.  
5. On `401/403` mark account error; on `429` cooldown; on network error try next.

**Modes (intelligent routing, light):**

| Mode | Preference |
|---|---|
| `auto` | Priority only |
| `balanced` | Prefer tavily/brave, searxng last |
| `fresh` | Prefer brave/tavily (news-ish APIs), boost recency param |
| `semantic` | Prefer exa, then tavily |
| `cheap` | Prefer searxng, then accounts with remaining free-ish quota |

## Security

- `SECRET_KEY` seals provider API keys at rest (AES-256-GCM) and keys managed API-token hashes.
- `ADMIN_TOKEN` protects UI + admin API; managed API keys protect `/v1/search`.
- Timing-safe bearer compare; no tokens in query strings.
- CSP / frame deny / nosniff; global per-IP rate limits plus managed-key provider/rate limits.
- `NODE_ENV=production` or `SG_ENFORCE_SECURE=1` refuses placeholder required secrets.
- Never log raw secrets. See [SECURITY.md](./SECURITY.md).
- Bind to LAN / reverse proxy with TLS for real deployments.

```bash
cp .env.example .env
npm install
npm start
# UI http://127.0.0.1:8787/
# Search: curl -H "Authorization: Bearer $SEARCH_GATEWAY_KEY" \
#   -H 'Content-Type: application/json' \
#   -d '{"query":"example domain","limit":3}' \
#   http://127.0.0.1:8787/v1/search
```

## Docker

```bash
cd /root/workspace/search-gateway   # or /opt/search-gateway
docker compose up -d --build
```

## Agent conventions

- Prefer small, boring modules; no framework churn.  
- Provider adapters: `(account, { query, limit, recency, signal }) → { results[], rawMeta? }` or throw `ProviderError`.  
- After schema changes, bump `SCHEMA_VERSION` in `db.js` and migrate.  
- Keep UI dependency-free (vanilla JS/CSS) unless a clear win.  
- Smoke-test: `npm run smoke` against a running server.  
- Do not commit `data/`, `.env`, or real keys.

## Integration notes

| Client | How |
|---|---|
| curl / scripts | `POST /v1/search` + managed API key from Admin UI → API keys |
| OMP | Prefer native Brave/Tavily keys **or** a future thin OMP provider pointing here; until then use MCP/HTTP tools |
| Paseo agents | Wrap this gateway as MCP or HTTP tool; single upstream URL |
| SearXNG | Add as `searxng` account with `baseUrl=http://searxng:8080` (compose network) or host IP |

## Non-goals

- LLM chat proxying  
- Browser/FlareSolverr CAPTCHA solving  
- Scraping Google/DDG HTML as first-class providers (use SearXNG if needed)  
