# syntax=docker/dockerfile:1.7

# Build native deps (better-sqlite3) in a throwaway stage, then ship only runtime files.
FROM node:20-alpine AS builder

RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
  && npm cache clean --force

COPY src ./src
COPY public ./public

FROM node:20-alpine AS runtime

WORKDIR /app

ENV HOST=0.0.0.0 \
    PORT=8787 \
    DATABASE_PATH=/data/gateway.db \
    NODE_ENV=production \
    OMNISEARCH_ENFORCE_SECURE=1

COPY package.json package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY src ./src
COPY public ./public
COPY LICENSE SECURITY.md AGENTS.md README.md ./

RUN mkdir -p /data

# Process runs as root by default so host bind-mounts are writable without host chown.
# For stricter setups, chown the data dir to uid 1000 and set USER node, or use a named volume.
EXPOSE 8787
VOLUME ["/data"]

CMD ["node", "src/index.js"]
