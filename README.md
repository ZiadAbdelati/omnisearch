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
# edit SECRET_KEY, ADMIN_TOKEN, GATEWAY_API_TOKEN
docker compose up -d --build
```

- UI: http://127.0.0.1:8787/  
- Search: `POST /v1/search` with `Authorization: Bearer $GATEWAY_API_TOKEN`

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

## Agent usage

```bash
curl -s http://127.0.0.1:8787/v1/search \
  -H "Authorization: Bearer $GATEWAY_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"example domain","limit":5,"mode":"auto"}'
```

Point MCP tools / custom agent tools at this single URL for lab-wide search.
