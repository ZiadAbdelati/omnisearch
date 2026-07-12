FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force

COPY src ./src
COPY public ./public
COPY AGENTS.md SECURITY.md LICENSE README.md ./

ENV HOST=0.0.0.0 \
    PORT=8787 \
    DATABASE_PATH=/data/gateway.db \
    NODE_ENV=production \
    SG_ENFORCE_SECURE=1

RUN mkdir -p /data

# Note: process runs as root by default so host bind-mounts (e.g. /opt/.../data)
# are writable without host chown. For stricter setups, chown the data dir to
# uid 1000 and set USER node, or use a named volume.

EXPOSE 8787
VOLUME ["/data"]

CMD ["node", "src/index.js"]
