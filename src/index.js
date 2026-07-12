const { config } = require("./config");
const { initDb } = require("./db");
const { createApp } = require("./app");
const { assertSecureConfig } = require("./security");

try {
  assertSecureConfig(config);
} catch (e) {
  console.error(e.message || e);
  process.exit(1);
}

// Soft warning in non-production
if (
  process.env.NODE_ENV !== "production" &&
  process.env.SG_ENFORCE_SECURE !== "1"
) {
  if (
    /change-me|dev-insecure|dev-local|admin-dev-token|gateway-dev-token/i.test(
      config.secretKey + config.adminToken + config.gatewayToken,
    )
  ) {
    console.warn(
      "[warn] Using development/placeholder secrets. Set strong SECRET_KEY, ADMIN_TOKEN, GATEWAY_API_TOKEN before any network exposure.",
    );
  }
}

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

function shutdown(signal) {
  console.log(`shutting down (${signal})`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
