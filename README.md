# OmniSearch

Self-hosted search gateway. Put your Brave, Tavily, Exa, Kagi, etc. keys in one place and give every script, agent, and MCP tool a single endpoint with one managed key.

It routes each query to the best available account, fails over on rate limits, enforces per-client quotas, and keeps provider keys encrypted at rest. Node 20 + Express + SQLite, no build step, vanilla-JS admin UI.

> Deploy on a private network. It stores third-party API keys and the admin UI is protected by a single shared token — not hardened for the open internet. See [SECURITY.md](./SECURITY.md).

## Why

Keys copied into a dozen `.env` files, no idea which provider ate your quota, hard failure whenever an API 429s. This fixes that:

- Multiple accounts per provider, each with its own quota and priority
- Failover: 429 → cooldown, 401/403 → flagged, network error → next candidate
- Routing modes (`auto`/`balanced`/`fresh`/`semantic`/`cheap`) bias provider choice
- Per-client managed keys with their own allowlist and rate limits — reroll without touching upstream keys
- Provider secrets sealed with AES-256-GCM; usage tracked per account/key by day and month

## Providers

| Provider | Key | Notes |
|---|---|---|
| `brave` | Brave Search API token | Quota read from rate-limit headers |
| `tavily` | `tvly-…` key | Credit usage reported |
| `exa` | Exa key | Neural/semantic results |
| `searxng` | optional bearer | Self-hosted; `baseUrl` required |
| `jina` | Jina key | `s.jina.ai` |
| `kagi` | Kagi token | |
| `firecrawl` | Firecrawl key | |
| `serpapi` | SerpAPI `api_key` | Usage reported |
| `bing` | Azure subscription key | Bing Web Search v7 |
| `google_pse` | `API_KEY:CX` | Programmable Search |
| `parallel` | Parallel key | |

## Quick start

```bash
git clone https://github.com/ZiadAbdelati/omnisearch.git
cd omnisearch
cp .env.example .env
# set SECRET_KEY and ADMIN_TOKEN (openssl rand -hex 32)
docker compose up -d --build   # or: npm install && npm start
```

Admin UI: <http://127.0.0.1:8787/> (log in with `ADMIN_TOKEN`).

First run:

1. **Accounts → Add** — pick a provider, paste its key, hit **Test** before saving.
2. **API keys → New** — create a managed key for your client. Shown once; copy it then.
3. Search:

```bash
curl -s http://127.0.0.1:8787/v1/search \
  -H "Authorization: Bearer $OMNISEARCH_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query":"example domain","limit":5}'
```

Prebuilt image: `docker pull ghcr.io/ziadabdelati/omnisearch:latest`

**Portainer note:** the stack editor has no build context, so `build: .` fails with a 500. Use an image instead (`image:` not `build:`) — see `docker-compose.portainer.yml`. If you run SearXNG in the same Docker network, set `DEFAULT_SEARXNG_URL=http://searxng:8080`.

## API

### `POST /v1/search`

Auth: `Authorization: Bearer <managed key>` or `X-API-Key: <managed key>`.

```json
{
  "query": "string",
  "limit": 10,
  "recency": "day|week|month|year",
  "providers": ["tavily", "brave"],
  "mode": "auto|balanced|fresh|semantic|cheap"
}
```

Only `query` is required. `providers` restricts this request (intersected with the key's allowlist).

```json
{
  "query": "example domain",
  "provider": "tavily",
  "accountName": "tavily-main",
  "tookMs": 123,
  "results": [{ "title": "…", "url": "https://…", "snippet": "…" }],
  "attempts": [{ "provider": "brave", "ok": false, "error": "rate_limited" }]
}
```

`attempts` lists every account tried before the one that answered — usually explains a slow or odd result.

### `GET /v1/search`

Same thing via query string: `?q=…&limit=10&mode=auto&recency=week&providers=brave,tavily`. Accepts Bearer, `X-API-Key`, or HTTP Basic.

### SearXNG-compatible JSON

`GET /v1/search?format=json` returns SearXNG-shaped results for clients that only speak SearXNG (accepts `q`, `count`, `time_range`):

```json
{
  "query": "…",
  "number_of_results": 1,
  "results": [{ "title": "…", "url": "https://…", "content": "…", "engine": "brave", "score": 1 }]
}
```

If the client only has a URL field (no key field), embed the key as basic-auth username: `http://<managed-key>:@omnisearch:8787/v1`. ⚠️ That key ends up in the client's settings/logs — use a dedicated restricted key and reroll it if exposed.

This is a narrow shim, not a SearXNG replacement: no HTML UI, no CSV/RSS, no pagination, no arbitrary engines. Native clients should use `POST /v1/search`.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `SECRET_KEY` | — | **Required.** Seals provider keys at rest (≥32 random bytes). |
| `ADMIN_TOKEN` | — | **Required.** Admin UI + `/admin/api/*`. |
| `HOST` / `PORT` | `0.0.0.0` / `8787` | Bind address |
| `DATABASE_PATH` | `./data/gateway.db` | SQLite location |
| `DEFAULT_SEARXNG_URL` | — | Seeds a SearXNG account on first boot if DB is empty |
| `TRUST_PROXY` | — | Set to `1` only behind a trusted reverse proxy |
| `RATE_LIMIT_GLOBAL_RPM` / `_SEARCH_RPM` / `_ADMIN_RPM` | `300` / `60` / `120` | Per-IP limits |

Rotating `SECRET_KEY` makes existing sealed keys unreadable — re-add your provider keys after.

## Development

```bash
npm install
npm start              # or: npm run dev
npm run smoke          # smoke test against a running server
```

Architecture, admin API reference, and contribution conventions live in [AGENTS.md](./AGENTS.md).

## Security

Short version: bind to a private interface (or TLS reverse proxy), give each client its own managed key, back up `data/gateway.db` as a secret, never commit `.env` or `data/`. Full details in [SECURITY.md](./SECURITY.md) — report vulnerabilities privately.

## Non-goals

LLM/chat proxying, CAPTCHA solving, scraping search engines' HTML. Need engines without an API? Run SearXNG and add it as a provider.

## License

[MIT](./LICENSE)
