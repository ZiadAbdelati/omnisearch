const path = require("path");
const express = require("express");
const searchRoutes = require("./routes/search");
const adminRoutes = require("./routes/admin");

function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "256kb" }));

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true, service: "search-gateway" });
  });

  app.use("/v1", searchRoutes);
  app.use("/admin/api", adminRoutes);

  const pub = path.join(process.cwd(), "public");
  app.use(express.static(pub));
  app.get(["/admin", "/admin/*"], (_req, res) => {
    res.sendFile(path.join(pub, "index.html"));
  });

  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: err.message || "Internal error" });
  });

  return app;
}

module.exports = { createApp };
