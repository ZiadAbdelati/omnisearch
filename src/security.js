const crypto = require("crypto");

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function timingSafeEqualStr(a, b) {
  const ba = Buffer.from(String(a || ""), "utf8");
  const bb = Buffer.from(String(b || ""), "utf8");
  if (ba.length !== bb.length) {
    // still do a compare to reduce length leaks slightly
    crypto.timingSafeEqual(ba.length ? ba : Buffer.alloc(1), ba.length ? ba : Buffer.alloc(1));
    return false;
  }
  if (ba.length === 0) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/** Reject obviously insecure bootstrap configs in production. */
function assertSecureConfig(config) {
  const prod =
    process.env.NODE_ENV === "production" ||
    process.env.SG_ENFORCE_SECURE === "1";
  if (!prod) return;

  const bad = [];
  if (!config.adminToken || config.adminToken.length < 10) {
    bad.push("ADMIN_TOKEN must be at least 10 characters");
  }
  if (
    /change-me|dev-insecure|dev-local/i.test(config.secretKey) ||
    config.secretKey === "dev-insecure-secret-key-change-me"
  ) {
    bad.push("SECRET_KEY looks like a placeholder");
  }
  if (!config.adminToken || config.adminToken.length < 10) {
    bad.push("ADMIN_TOKEN must be at least 10 characters");
  }
  // Only reject obvious template placeholders, not user-chosen short passwords
  if (/^(change-me|admin-dev-token|gateway-dev-token)$/i.test(config.adminToken)) {
    bad.push("ADMIN_TOKEN looks like a placeholder");
  }
  if (config.gatewayToken && /^(change-me|change-me-gateway-token|gateway-dev-token)$/i.test(config.gatewayToken)) {
    bad.push("GATEWAY_API_TOKEN looks like a placeholder");
  }
  if (config.adminToken === config.gatewayToken) {
    bad.push("ADMIN_TOKEN and GATEWAY_API_TOKEN must differ");
  }
  if (bad.length) {
    throw new Error(
      `Refusing to start with insecure config (NODE_ENV=production or SG_ENFORCE_SECURE=1):\n- ${bad.join("\n- ")}`,
    );
  }
}

function securityHeaders(req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "connect-src 'self'",
      "font-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
  );
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=()",
  );
  // API responses should not be cached by shared caches
  if (req.path.startsWith("/v1") || req.path.startsWith("/admin/api")) {
    res.setHeader("Cache-Control", "no-store");
  }
  next();
}

/**
 * Simple fixed-window rate limiter per IP+bucket.
 * @param {{ windowMs: number, max: number, bucket?: (req)=>string, skip?: (req)=>boolean }} opts
 */
function rateLimit({ windowMs, max, bucket, skip }) {
  const hits = new Map();
  // opportunistic cleanup
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) {
      if (v.reset < now) hits.delete(k);
    }
  }, Math.min(windowMs, 60_000)).unref?.();

  return function rateLimitMiddleware(req, res, next) {
    if (skip?.(req)) return next();
    const ip =
      (req.headers["x-forwarded-for"] &&
        String(req.headers["x-forwarded-for"]).split(",")[0].trim()) ||
      req.socket.remoteAddress ||
      "unknown";
    const b = bucket ? bucket(req) : "default";
    const key = `${b}:${ip}`;
    const now = Date.now();
    let ent = hits.get(key);
    if (!ent || ent.reset < now) {
      ent = { count: 0, reset: now + windowMs };
      hits.set(key, ent);
    }
    ent.count += 1;
    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader(
      "X-RateLimit-Remaining",
      String(Math.max(0, max - ent.count)),
    );
    if (ent.count > max) {
      res.setHeader(
        "Retry-After",
        String(Math.ceil((ent.reset - now) / 1000)),
      );
      return res.status(429).json({ error: "Rate limit exceeded" });
    }
    next();
  };
}

/** Soft body-size already handled by express.json; reject unexpected content types on write APIs */
function requireJson(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  const ct = req.headers["content-type"] || "";
  if (!ct.includes("application/json") && req.method !== "DELETE") {
    // allow empty DELETE
    if (req.method === "POST" || req.method === "PUT" || req.method === "PATCH") {
      // express may have already parsed; if no body keys and no content-length, ok for some
      const len = Number(req.headers["content-length"] || 0);
      if (len > 0 && !ct.includes("application/json")) {
        return res.status(415).json({ error: "Content-Type must be application/json" });
      }
    }
  }
  next();
}

function sanitizeErrorMessage(err) {
  const msg = err && err.message ? String(err.message) : "Internal error";
  // strip potential secret-looking substrings
  return msg
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/tvly-[A-Za-z0-9_-]+/g, "tvly-[redacted]")
    .replace(/BSA[A-Za-z0-9_-]+/g, "BSA[redacted]");
}

module.exports = {
  timingSafeEqualStr,
  assertSecureConfig,
  securityHeaders,
  rateLimit,
  requireJson,
  sanitizeErrorMessage,
};
