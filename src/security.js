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

/**
 * True when the strict startup checks are requested.
 * `SG_ENFORCE_SECURE` is the pre-rename spelling, still honoured so existing
 * deployments keep working.
 */
function enforceSecure() {
  return (
    process.env.OMNISEARCH_ENFORCE_SECURE === "1" ||
    process.env.SG_ENFORCE_SECURE === "1"
  );
}

/** Reject obviously insecure bootstrap configs in production. */
function assertSecureConfig(config) {
  const prod = process.env.NODE_ENV === "production" || enforceSecure();
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
      `Refusing to start with insecure config (NODE_ENV=production or OMNISEARCH_ENFORCE_SECURE=1):\n- ${bad.join("\n- ")}`,
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

/**
 * Strip credentials out of free-form text before it is returned to a client,
 * written to the usage log, or printed.
 *
 * Upstream error bodies and fetch failure messages routinely carry the key we
 * just sent: providers echo request URLs (SerpAPI and Google PSE pass the key
 * as a query parameter), a SearXNG baseUrl may embed HTTP basic credentials,
 * and some APIs quote the rejected key back in the error body.
 */
function redactSecrets(text) {
  if (text == null) return text;
  let out = String(text);

  // URL userinfo: http://user:pass@host → http://[redacted]@host
  out = out.replace(/:\/\/[^\s/?#@]+@/g, "://[redacted]@");

  // Credential-bearing query parameters
  out = out.replace(
    /([?&](?:api[-_]?key|key|token|access[-_]token|auth|secret|password|subscription[-_]key|x-api-key)=)[^&\s"'`]+/gi,
    "$1[redacted]",
  );

  // Authorization-style headers quoted in an error
  out = out.replace(
    /\b(authorization|x-api-key|x-subscription-token|ocp-apim-subscription-key)(\s*[:=]\s*)[^\s,;"'`]+/gi,
    "$1$2[redacted]",
  );

  // Bare auth schemes
  out = out.replace(
    /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi,
    "$1 [redacted]",
  );

  // Recognizable provider key shapes, wherever they appear
  out = out
    .replace(/\btvly-[A-Za-z0-9_-]+/g, "tvly-[redacted]")
    .replace(/\bBSA[A-Za-z0-9_-]{10,}/g, "BSA[redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{16,}/g, "sk-[redacted]")
    .replace(/\bAIza[0-9A-Za-z_-]{30,}/g, "AIza[redacted]")
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}/g, "github_pat_[redacted]")
    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}/g, "gh_[redacted]");

  return out;
}

/**
 * Shape a thrown search error into a safe JSON body.
 * Redacts the top-level message and every recorded attempt.
 */
function errorPayload(err) {
  const attempts = Array.isArray(err?.attempts)
    ? err.attempts.map((a) =>
        a && a.error ? { ...a, error: redactSecrets(a.error) } : a,
      )
    : undefined;
  return {
    error: redactSecrets(err?.message || String(err)),
    attempts,
  };
}

function sanitizeErrorMessage(err) {
  const msg = err && err.message ? String(err.message) : "Internal error";
  return redactSecrets(msg);
}

module.exports = {
  timingSafeEqualStr,
  assertSecureConfig,
  securityHeaders,
  rateLimit,
  requireJson,
  enforceSecure,
  redactSecrets,
  errorPayload,
  sanitizeErrorMessage,
};
