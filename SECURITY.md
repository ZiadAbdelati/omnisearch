# Security Policy

## Threat model (summary)

Search Gateway is a **trusted-lab / self-hosted** service that:

- Stores third-party search API keys (encrypted at rest)
- Exposes a **bearer-authenticated** search API
- Exposes an **admin UI** for key management

It is **not** hardened as a multi-tenant public SaaS. Deploy behind a private network, VPN, or reverse proxy with TLS. Do not expose the admin UI to the open internet without additional controls.

## Required secrets

| Variable | Role | Guidance |
|---|---|---|
| `SECRET_KEY` | AES-256-GCM key material for sealing API keys | ≥32 random bytes (e.g. `openssl rand -hex 32`) |
| `ADMIN_TOKEN` | Admin UI + `/admin/api/*` | ≥16 chars, high entropy, **≠** gateway token |
| `GATEWAY_API_TOKEN` | `/v1/search` clients | ≥16 chars, high entropy |

With `NODE_ENV=production` or `SG_ENFORCE_SECURE=1`, the process **refuses to start** if tokens look like placeholders or are too short.

## What we implement

- Secrets encrypted at rest (AES-256-GCM); only sealed blobs in SQLite
- Timing-safe bearer comparison
- No secrets in query strings (removed on purpose)
- Security headers (CSP, frame deny, nosniff, no-store on APIs)
- JSON body size limit (64kb)
- Per-IP rate limits (global / search / admin) — tune via env
- Production config assertion
- Provider errors sanitized in logs (best-effort redaction)
- Static files: `dotfiles: deny`

## Deploy checklist

1. Generate unique `SECRET_KEY`, `ADMIN_TOKEN`, `GATEWAY_API_TOKEN` per environment.  
2. Set `NODE_ENV=production` (Docker image default).  
3. Bind to private interface or put behind reverse proxy with TLS.  
4. Prefer `TRUST_PROXY=1` only when behind a trusted reverse proxy.  
5. Restrict firewall: only LAN/VPN to `:8787`.  
6. Back up `/data/gateway.db` as sensitive (contains encrypted keys + usage).  
7. Rotate tokens by redeploying env; re-enter provider API keys if you change `SECRET_KEY` (old seals become undecryptable).  
8. Do not commit `.env` or `data/`.

## Changing SECRET_KEY

Changing `SECRET_KEY` makes previously sealed API keys unreadable. Export/re-add provider keys after rotation, or wipe the DB volume.

## Reporting vulnerabilities

If you find a security issue in this project, please open a private advisory or contact the maintainer rather than filing a public issue with exploit details.
