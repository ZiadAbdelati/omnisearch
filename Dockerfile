FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src
COPY public ./public
COPY AGENTS.md ./

ENV HOST=0.0.0.0
ENV PORT=8787
ENV DATABASE_PATH=/data/gateway.db

EXPOSE 8787
VOLUME ["/data"]

CMD ["node", "src/index.js"]
