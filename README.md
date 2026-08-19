# OmniSearch

Self-hosted search gateway. Put your Brave, Tavily, Exa, Kagi (and other) API keys in one place, and give every script, agent, and MCP tool a single endpoint to call.

OmniSearch sits between your clients and eleven upstream search APIs. It holds the provider keys encrypted at rest, routes each query to the best available account, fails over when one is rate-limited or down, and enforces per-client quotas so a runaway agent can't burn a month of credits in an afternoon.

```
your agents ──▶ POST /v1/search ──▶ [ routing + quotas + failover ] ──▶ Brave / Tavily / Exa / SearXNG / …
                (one managed key)                                        (your provider keys, encrypted)
```

> **Deploy this on a private network.** It stores third-party API keys and its admin UI is protected by a single shared token. It is not hardened for the open internet. See [SECURITY.md](./SECURITY.md).

## Why

Running search across several agents gets messy fast: keys copied into a dozen `.env` files, no idea which provider ate your quota, and a hard failure whenever one API returns 429. OmniSearch centralizes that:

- **Many accounts per provider** — several Brave keys, each with its own quota, rotated automatically.
- **Priority, weight, and quotas** — per-account daily/monthly/RPM limits and cooldowns; lower priority number is tried first.
- **Automatic failover** — on `429` an account cools down, on `401/403` it's flagged, on a network error the next candidate is tried.
- **Routing modes** — `auto`, `balanced`, `fresh`, `semantic`, `cheap` bias the candidate order toward the right kind of provider.
- **Per-client keys** — issue a managed key per consumer with its own provider allowlist and rate limits, and reroll it without touching your upstream keys.
- **Encrypted at rest** — provider secrets are sealed with AES-256-GCM; only sealed blobs land in SQLite.
- **Usage tracking** — per-account and per-key counts by day and month, plus provider-reported quota where the upstream exposes it.

No build step, no framework churn: Node 20, Express, SQLite, and a vanilla-JS admin UI.

## Supported providers

| Provider | Key | Notes |
|---|---|---|
| `brave` | Brave Search API subscription token | Quota read from rate-limit response headers |
| `tavily` | `tvly-…` API key | Provider-side credit usage reported |
| `exa` | Exa API key | Neural/semantic results |
| `searxng` | *optional* bearer | Self-hosted; `baseUrl` required |
| `jina` | Jina API key | `s.jina.ai` |
| `kagi` | Kagi API token | |
| `firecrawl` | Firecrawl API key | |
| `serpapi` | SerpAPI `api_key` | Provider-side usage reported |
| `bing` | Azure subscription key | Bing Web Search v7 |
| `google_pse` | `API_KEY:CX` | Google Programmable Search |
| `parallel` | Parallel API key | |

## Quick start

### Docker

```bash
git clone https://github.com/ZiadAbdelati/omnisearch.git
cd omnisearch
cp .env.example .env
# set SECRET_KEY and ADMIN_TOKEN to your own long random values
docker compose up -d --build
```

### Node

```bash
git clone https://github.com/ZiadAbdelati/omnisearch.git
cd omnisearch
cp .env.example .env
npm install
npm start
```

Either way the admin UI is at <http://127.0.0.1:8787/>. Log in with your `ADMIN_TOKEN`.

Generate `SECRET_KEY` and `ADMIN_TOKEN` with something like:

```bash
openssl rand -hex 32
```

### First run

1. **Accounts → Add** — pick a provider, paste its key, hit **Test** to verify it before saving.
2. **API keys → New** — create a managed key for your client. Restrict which providers it may use and give it an RPM/day/month cap. **The key is shown once**; copy it then.
3. Call the API with that key:

```bash
curl -s http://127.0.0.1:8787/v1/search \
  -H "Authorization: Bearer $OMNISEARCH_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query":"example domain","limit":5,"mode":"auto"}'
```

## API

### `POST /v1/search`

Authenticate with `Authorization: Bearer <managed key>` or `X-API-Key: <managed key>`.

```json
{
  "query": "string",
  "limit": 10,
  "recency": "day|week|month|year",
  "providers": ["tavily", "brave"],
  "mode": "auto|balanced|fresh|semantic|cheap"
}
```

Only `query` is required. `providers` restricts this one request to a subset (intersected with the key's own allowlist).

Response:

```json
{
  "query": "example domain",
  "provider": "tavily",
  "accountId": "…",
  "accountName": "tavily-main",
  "tookMs": 123,
  "results": [
    { "title": "…", "url": "https://…", "snippet": "…", "publishedAt": null }
  ],
  "attempts": [
    { "accountId": "…", "provider": "brave", "ok": false, "error": "rate_limited", "ms": 40 }
  ]
}
```

`attempts` records every account tried before the one that answered, which is usually enough to explain a slow or surprising result.

### `GET /v1/search`

Same routing, query-string arguments: `?q=…&limit=10&mode=auto&recency=week&providers=brave,tavily`. Accepts Bearer, `X-API-Key`, or HTTP Basic.

### Routing modes

| Mode | Preference |
|---|---|
| `auto` | Priority order only |
| `balanced` | Prefer Tavily/Brave, SearXNG last |
| `fresh` | Prefer news-oriented APIs, boost the recency parameter |
| `semantic` | Prefer Exa, then Tavily |
| `cheap` | Prefer SearXNG, then accounts with quota to spare |

Within a mode: filter to enabled accounts that are under quota and not cooling down, sort by priority ascending, break ties by weighted random, then by least-used today. Try candidates until one returns at least one result.

### SearXNG-compatible JSON

`GET /v1/search?format=json` returns a SearXNG-shaped payload for clients that only speak SearXNG:

```json
{
  "query": "…",
  "number_of_results": 1,
  "results": [
    { "title": "…", "url": "https://…", "content": "…", "engine": "brave", "score": 1, "category": "general" }
  ]
}
```

It accepts `q`, `count`, and `time_range`, and authenticates via Basic, Bearer, or `X-API-Key`. Basic auth exists for clients whose SearXNG settings offer a URL field but no API-key field — embed the key as the username with an empty password:

```text
http://<managed-key>:@omnisearch:8787/v1
```

⚠️ A key embedded in a URL is stored in that client's settings and may appear in its logs or backups. Use a dedicated, restricted key for it and reroll the key if that host is ever exposed.

**This is a narrow compatibility shim, not a SearXNG replacement.** There is no HTML UI, no root `/` endpoint, no form POST, no CSV/RSS, no pagination, no arbitrary engines or categories, and no plugin support. Native clients should use `POST /v1/search` with Bearer auth.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `SECRET_KEY` | — | **Required.** Seals provider keys at rest. Use ≥32 random bytes. |
| `ADMIN_TOKEN` | — | **Required.** Admin UI and `/admin/api/*`. Acts as a password. |
| `HOST` / `PORT` | `0.0.0.0` / `8787` | Bind address |
| `DATABASE_PATH` | `./data/gateway.db` | SQLite location |
| `DEFAULT_SEARXNG_URL` | — | Seeds a SearXNG account on first boot if the DB is empty |
| `GATEWAY_API_TOKEN` | — | Optional legacy seed, imported once as a managed key |
| `NODE_ENV` / `SG_ENFORCE_SECURE` | set in the Docker image | Refuse to start on placeholder secrets |
| `TRUST_PROXY` | — | Set to `1` only behind a trusted reverse proxy |
| `RATE_LIMIT_GLOBAL_RPM` / `_SEARCH_RPM` / `_ADMIN_RPM` | `300` / `60` / `120` | Per-IP limits |

Changing `SECRET_KEY` makes existing sealed provider keys unreadable — re-add them after a rotation.

## Deployment

### Prebuilt image

Images are published to GitHub Container Registry by the manual **Publish Docker image** workflow (Actions → Run workflow, optionally with an extra tag):

```bash
docker pull ghcr.io/ziadabdelati/omnisearch:latest
```

### Portainer

Portainer's stack editor has no build context, so `build: .` typically fails with an HTTP 500. Use a prebuilt image instead — see `docker-compose.portainer.yml`:

1. Build once on the Docker host (`docker build -t omnisearch:latest .`) or pull from GHCR.
2. Reference `image:` rather than `build:` in the stack.
3. Put the service on the same Docker network as your SearXNG instance and set `DEFAULT_SEARXNG_URL=http://searxng:8080`.

## Admin UI

A dependency-free static SPA under `public/`, with responsive layouts for Accounts, API keys, Usage, Test search, and Settings. It covers everything the admin API does: adding and testing provider accounts, issuing and rerolling managed keys, browsing usage by day/month/provider/key, and running ad-hoc test searches.

## Development

```bash
npm install
npm start              # or: npm run dev  (node --watch)
npm run smoke          # smoke test against a running server
node scripts/ui-regressions.js
node scripts/stats-filter-regressions.js
```

Architecture, module layout, the full admin API table, and the conventions to follow when changing things are in [AGENTS.md](./AGENTS.md).

## Security

Read [SECURITY.md](./SECURITY.md) before exposing this anywhere. The short version:

- Bind to a private interface, or put it behind a reverse proxy with TLS. Do not put the admin UI on the open internet.
- Give every client its own managed key with a provider allowlist and quota, rather than sharing one.
- `data/gateway.db` holds your encrypted provider keys and managed-key hashes. Back it up as a secret.
- Never commit `.env` or `data/`.

Please report vulnerabilities privately rather than in a public issue.

## Non-goals

LLM/chat proxying, CAPTCHA solving, and scraping search engines' HTML pages. If you need engines without an API, run SearXNG and add it as a provider.

## License

[MIT](./LICENSE)
