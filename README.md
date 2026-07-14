# OmniSearch

Self-hosted multi-provider **web search proxy** with an OmniSearch admin UI.

- Multiple accounts per provider (e.g. several Brave keys)
- Priority, weight, daily/monthly/RPM limits, cooldowns
- Failover across Tavily → Brave → Exa → SearXNG (configurable)
- Light intelligent routing modes: `auto`, `balanced`, `fresh`, `semantic`, `cheap`
- Credential test on add/edit
- Encrypted secrets at rest (AES-256-GCM)

See [AGENTS.md](./AGENTS.md) for architecture and agent conventions.

## Quick start (Docker)

```bash
cd omnisearch
cp .env.example .env
# edit SECRET_KEY and ADMIN_TOKEN
docker compose up -d --build
```

- Admin UI: http://127.0.0.1:8787/
- Native search: generate a managed key in **API keys**, then call `POST /v1/search` with `Authorization: Bearer <managed key>`.
- SearXNG JSON compatibility: authenticated `GET /v1/search?format=json&q=...`; supports the Odysseus request contract only.

## GitHub Container Registry

This repository includes a manual workflow at `.github/workflows/docker-publish.yml`.

1. In GitHub → **Actions** → **Build and publish Docker image** → **Run workflow**.
2. Optionally set an extra tag (for example `v1.0.0`) and choose whether to push `latest`.
3. Pull the image:
   ```bash
   docker pull ghcr.io/ziadabdelati/omnisearch:latest
   ```

If the package is private, authenticate first:
```bash
echo "$GITHUB_TOKEN" | docker login ghcr.io -u USERNAME --password-stdin
```

## Portainer

Portainer stack editor **`build: .` often fails with HTTP 500** — there is no build context (source tree) when you only paste YAML.

1. On the Docker host, build once:
   ```bash
   git clone https://github.com/ZiadAbdelati/omnisearch.git
   cd omnisearch
   docker build -t omnisearch:latest .
   mkdir -p ./data
   ```
2. In the stack, use **`image: omnisearch:latest`** (see `docker-compose.portainer.yml`), not `build: .`.
3. Put the service on the same Docker network as SearXNG and set `DEFAULT_SEARXNG_URL=http://searxng:8080`.

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
| searxng | optional bearer | **required** e.g. `http://searxng:8080` |

Lower **priority** is tried first. Use **Test** before saving if you want.

The Accounts table shows gateway usage inline as `rpm`, `d` (today), and `m` (month). Provider-side quota/credit usage is available for Tavily and SerpAPI. Brave quota is captured from rate-limit headers on every successful Brave search or account test; it reports the plan's longest quota window without issuing a separate upstream usage request.


## Admin UI

The admin UI is a dependency-free static SPA under `public/`. It includes responsive mobile layouts for Accounts, API keys, Usage, Test search, and Settings.

- Usage filters collapse to a single-column mobile card.
- Form controls share a fixed 40px control height across text inputs, date inputs, number inputs, and selects for visual consistency across mobile browsers.
- The Test search and Settings forms use the same flat panel surface as the rest of the console.
- Static asset URLs are cache-busted with query versions (`styles.css?v=...`, `app.js?v=...`) whenever shipped CSS/JS behavior changes.

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

Odysseus’s **SearXNG (self-hosted)** provider issues authenticated JSON searches using `/search?format=json`; its settings UI has no separate API-key field. OmniSearch supports the SearXNG JSON subset Odysseus needs.

1. In **API keys**, create a dedicated, least-privilege gateway key for Odysseus. Restrict its providers and apply a suitable RPM/day/month quota.
2. In Odysseus **Settings → Web Search**, select **SearXNG (self-hosted)** and set the URL to:
   ```text
   http://<gateway-key>:@omnisearch:8787/v1
   ```
   The trailing `@` supplies `<gateway-key>` as the HTTP Basic username with an empty password. Use the gateway hostname only when Odysseus shares a Docker network with OmniSearch; otherwise use the gateway's reachable host/IP.
3. Click **Test**. The URL must retain the `/v1` suffix.

Odysseus persists that URL in application settings, and its HTTP client may log the complete URL including the Basic-auth username. Docker access, Odysseus logs, and an Odysseus application-data backup can expose the embedded key. Treat it as an application secret: use a dedicated key, restrict it, and reroll it from the gateway UI if the Odysseus host, logs, or backup is exposed.

The endpoint supports `GET /v1/search?format=json` with `q`, `count`, and `time_range`; it emits SearXNG-shaped `results`. It is **not** a complete SearXNG replacement: no HTML UI, root `/`, form POST, CSV/RSS, pagination, arbitrary engines/categories, or SearXNG plugins. Native clients should use Bearer authentication with `POST /v1/search`.
