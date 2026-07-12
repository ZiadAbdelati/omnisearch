# Search Gateway

Self-hosted multi-provider **web search proxy** with an OmniRoute-style admin UI.

- Multiple accounts per provider (e.g. several Brave keys)
- Priority, weight, daily/monthly/RPM limits, cooldowns
- Failover across Tavily → Brave → Exa → SearXNG (configurable)
- Light intelligent routing modes: `auto`, `balanced`, `fresh`, `semantic`, `cheap`
- Credential test on add/edit
- Encrypted secrets at rest (AES-256-GCM)

See [AGENTS.md](./AGENTS.md) for architecture and agent conventions.

## Quick start (Docker)

```bash
cd search-gateway
cp .env.example .env
# edit SECRET_KEY and ADMIN_TOKEN
docker compose up -d --build
```

- UI: http://127.0.0.1:8787/
- Search: generate a managed key in **API keys**, then call `/v1/search` with `Authorization: Bearer <managed key>`

## Portainer

Portainer stack editor **`build: .` often fails with HTTP 500** — there is no build context (source tree) when you only paste YAML.

1. On the Docker host, build once:
   ```bash
   cd /root/workspace/search-gateway   # or /opt/search-gateway/src-tree
   docker build -t search-gateway:latest .
   mkdir -p /opt/search-gateway/data
   ```
2. In the stack, use **`image: search-gateway:latest`** (see `docker-compose.portainer.yml`), not `build: .`.
3. Put the service on the same external network as SearXNG (e.g. `paseo`) and set `DEFAULT_SEARXNG_URL=http://searxng:8080`.

## Quick start (Node)

```bash
cp .env.example .env
npm install
npm start
```

## Add providers

In the UI (**Accounts → Add**):

| Provider | Secret | Base URL |
|---|---|---|
| tavily | API key | optional |
| brave | API key | optional |
| exa | API key | optional |
| searxng | optional bearer | **required** e.g. `http://192.168.50.29:8080` |

Lower **priority** is tried first. Use **Test** before saving if you want.

The Accounts table shows gateway usage inline as `rpm`, `d` (today), and `m` (month). Provider-side quota/credit usage is available for Tavily and SerpAPI. Brave quota is captured from rate-limit headers on every successful Brave search or account test; it reports the plan's longest quota window without issuing a separate upstream usage request.

## Agent usage

Generate a key in **API keys** first. Use per-key provider allowlists and RPM/day/month limits for clients.

```bash
curl -s http://127.0.0.1:8787/v1/search \
  -H "Authorization: Bearer $SEARCH_GATEWAY_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query":"example domain","limit":5,"mode":"auto"}'
```

Point MCP tools / custom agent tools at this single URL for lab-wide search.

## Odysseus integration

Odysseus’s **SearXNG (self-hosted)** provider only sends `GET /search?format=json` and its settings UI has no API-key field. Search Gateway exposes an authenticated SearXNG-compatible endpoint for it.

1. In **API keys**, create a dedicated gateway key for Odysseus.
2. In Odysseus **Settings → Web Search**, select **SearXNG (self-hosted)** and set the URL to:
   ```text
   http://<gateway-key>:@search-gateway:8787/v1
   ```
   The trailing `@` makes `<gateway-key>` the HTTP Basic username. Use `search-gateway` only when the Odysseus container shares the `paseo` Docker network; otherwise use the gateway's reachable host/IP.
3. Click **Test**. The key remains in Basic authentication and is not placed in the request URL query string.

The compatibility endpoint supports SearXNG JSON requests at `/v1/search?format=json`, translates `q`, `count`, and `time_range`, and returns SearXNG-shaped `results`. Native gateway clients should continue using Bearer authentication with `/v1/search`.
