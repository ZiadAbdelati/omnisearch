const path = require("path");
const express = require("express");
const searchRoutes = require("./routes/search");
const adminRoutes = require("./routes/admin");
const {
  securityHeaders,
  rateLimit,
  requireJson,
  sanitizeErrorMessage,
} = require("./security");

function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", process.env.TRUST_PROXY === "1" ? 1 : false);

  app.use(securityHeaders);
  app.use(express.json({ limit: "64kb" }));
  app.use(requireJson);

  // Global coarse limit
  app.use(
    rateLimit({
      windowMs: 60_000,
      max: Number(process.env.RATE_LIMIT_GLOBAL_RPM || 300),
      bucket: () => "global",
    }),
  );

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true, service: "search-gateway" });
  });

  // Public search — tighter limit
  app.use(
    "/v1",
    rateLimit({
      windowMs: 60_000,
      max: Number(process.env.RATE_LIMIT_SEARCH_RPM || 60),
      bucket: () => "search",
    }),
    searchRoutes,
  );

  app.use(
    "/admin/api",
    rateLimit({
      windowMs: 60_000,
      max: Number(process.env.RATE_LIMIT_ADMIN_RPM || 120),
      bucket: () => "admin",
      skip: (req) => req.method === "GET" && req.path === "/bootstrap",
    }),
    adminRoutes,
  );

  const pub = path.join(process.cwd(), "public");
  app.use(
    express.static(pub, {
      dotfiles: "deny",
      index: "index.html",
      setHeaders(res, filePath) {
        if (filePath.endsWith(".html")) {
          res.setHeader("Cache-Control", "no-store");
        } else {
          res.setHeader("Cache-Control", "public, max-age=3600");
        }
      },
    }),
  );

  // SPA fallback for /admin only (not arbitrary paths)
  app.get(["/admin", "/admin/"], (_req, res) => {
    res.sendFile(path.join(pub, "index.html"));
  });

  app.use((req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  app.use((err, _req, res, _next) => {
    console.error("[error]", sanitizeErrorMessage(err));
    res.status(500).json({ error: "Internal error" });
  });

  return app;
}

module.exports = { createApp };
