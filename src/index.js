const { config } = require("./config");
const { initDb } = require("./db");
const { createApp } = require("./app");

initDb();
const app = createApp();

const server = app.listen(config.port, config.host, () => {
  console.log(
    `search-gateway listening on http://${config.host}:${config.port}`,
  );
  console.log(`  admin UI:  http://127.0.0.1:${config.port}/`);
  console.log(`  search:    POST /v1/search`);
  console.log(`  health:    GET  /healthz`);
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
