/**
 * Express application assembly — wires the middleware chain (security headers,
 * body limits, request logging/timing, session cookies), mounts the `/api`
 * router, and serves the built SPA from STATIC_DIR in single-container mode. The
 * gateway's composition root; route logic lives in routes/, broker logic below
 * the seam in broker/.
 */
import path from "node:path";
import fs from "node:fs";
import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { wellKnownRouter } from "./routes/well-known";
import { logger } from "./lib/logger";
import { runWithTiming, getUpstreamMs } from "./lib/request-timing";
import { runSecuritySelfCheck } from "./lib/security-check";
import { runDevModeGuard } from "./lib/dev-mode-guard";
import { resolveSessionSecret } from "./lib/session-secret-guard";
import { isDevMode } from "./lib/dev-mode";
import { httpRequestStarted, recordHttpRequest } from "./lib/runtime-metrics";
import { errorHandler } from "./lib/error-handler";
import { compression } from "./lib/compression";
import { slideSession } from "./routes/auth";
import { csrfGuard } from "./lib/csrf";
import { loadSecurityState } from "./lib/security-state";
import { hydrateVault } from "./lib/vault";
import { initKms } from "./lib/kms";
import { contentSecurityPolicy, cspHeaderName, cspNonce } from "./lib/csp";
import { tracingMiddleware } from "./lib/tracing";
import { ipAllowGuard } from "./lib/ip-allow";
import { maintenanceGuard } from "./lib/maintenance";
import { requireTls } from "./lib/deployment-profile";
import { stripDangerousKeys } from "./lib/safe-json";
import { resolveTrustProxy } from "./lib/trust-proxy";
import { configuredCorsOrigins } from "./lib/origin-allowlist";

const app: Express = express();

// Honour X-Forwarded-* headers (Traefik / k8s ingress) so OIDC redirect URIs and secure-cookie
// detection resolve to the public origin — but ONLY when the operator has confirmed a trusted
// proxy is actually there (TRUST_PROXY). Off by default.
app.set("trust proxy", resolveTrustProxy(process.env["TRUST_PROXY"]));

// Response compression (gzip/brotli) — first in the chain so it wraps the final
// body of every API + SPA response. SSE/ranged/binary responses pass through.
app.use(compression());

// App-layer IP allowlisting (defence in depth; no-op unless IP_ALLOWLIST is set). Runs early
// so a disallowed network is refused before any work. Health/readiness probes are exempt so
// orchestration checks from the LB always succeed.
app.use((req, res, next) => {
  if (req.path.endsWith("/healthz") || req.path.endsWith("/readyz")) { next(); return; }
  ipAllowGuard(req, res, next);
});

// The session-cookie signing key. In production it MUST come from the
// environment: an unset/empty/default value would sign auth cookies with a
// world-readable constant, making sessions and roles forgeable (see
// security.test.ts, which mints an admin session from a known secret). So we
// fail fast rather than boot silently-insecure — see lib/session-secret-guard.ts
// for the full threat model and the (pure, unit-tested) decision logic.
const SESSION_SECRET = resolveSessionSecret();

// Loudly surface dangerous production config combinations at boot (and refuse to
// boot in SECURITY_STRICT mode on a critical finding). Complements the hard
// SESSION_SECRET fail-fast above.
runSecuritySelfCheck(process.env, logger);

// Hard interlock: refuse to boot if DEV MODE is active in a production-like
// environment (real SSO / licence / public host). Dev mode can impersonate users
// and toggle paid features, so it must never run where it could be reached.
runDevModeGuard(process.env, logger);

/**
 * Async boot side-effects that must run BEFORE the server serves AND before any sealed
 * config/state is read. Order matters:
 *   1. initKms() — unwrap KMS-wrapped root keys (config + vault) so the at-rest crypto opens
 *      under the right material;
 *   2. loadSecurityState() — restore revocations/grants/etc. (reads the SEALED state file);
 *   3. hydrateVault() — fill the AI key vault cache from its (possibly external) store.
 * The caller (index.ts) awaits this before loadConfigDir() + listen(). No-op-friendly: with
 * no KMS / no state file / local vault, each step is cheap or lazy, so tests that import the
 * app without calling bootstrap() still work.
 */
export async function bootstrap(): Promise<void> {
  await initKms();
  loadSecurityState();
  await hydrateVault();
}

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
// W3C trace context: continue/begin a trace, correlate req.log, echo traceparent +
// x-request-id, propagate via AsyncLocalStorage, and export an OTLP span when configured.
// Runs right after pinoHttp so it can enrich the request logger.
app.use(tracingMiddleware);
// CORS: no origin is trusted by default (deny cross-origin reads) — the common single-container/
// reverse-proxy deployment serves the SPA + API from the same origin, where CORS never even
// applies. PUBLIC_URL / CORS_ALLOWED_ORIGINS / CSRF_TRUSTED_ORIGINS opt specific origins in; see
// lib/origin-allowlist.ts. Requests with no Origin header (same-origin, curl, server-to-server)
// are unaffected either way — CORS is a browser-side, cross-origin-only restriction.
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || configuredCorsOrigins().has(origin.toLowerCase())) callback(null, true);
      else callback(null, false);
    },
  }),
);

// Baseline security headers on every response (API + SPA). Deliberately
// conservative — no CSP here (it would need per-deployment tuning for the SPA's
// font/asset origins); these are the safe, universally-applicable ones.
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-DNS-Prefetch-Control", "off");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  // microphone=(self): the on-device / Whisper dictation needs same-origin mic access.
  res.setHeader("Permissions-Policy", "camera=(), microphone=(self), geolocation=()");
  // Content-Security-Policy: strict-by-default, fully overridable per deployment, and
  // settable to report-only while a deployment tunes it for its asset origins. A
  // per-request nonce is minted and added to script-src (defence-in-depth); it's
  // exposed on res.locals so a server-rendered <script> could carry it.
  const nonce = cspNonce();
  res.locals["cspNonce"] = nonce;
  res.setHeader(cspHeaderName(), contentSecurityPolicy(nonce));
  // HSTS only when the deployment is actually served over TLS (per the profile/PUBLIC_TLS) —
  // meaningless/counterproductive on a plain-HTTP LAN deployment.
  if (requireTls()) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
});

app.use(cookieParser(SESSION_SECRET));
// Enforce + slide the session idle/absolute timeout before any route reads it.
app.use(slideSession);
// CSRF: reject cross-origin / token-less cookie-authenticated mutations. Runs after
// the cookie parser (needs the session + csrf cookies) and after slideSession (which
// issues the csrf cookie for active sessions). Machine callers carry no session cookie
// and pass through untouched.
app.use(csrfGuard);
// Hard-enforce request body size (defence against memory-exhaustion / oversized
// payloads). Explicit + configurable rather than relying on Express's implicit
// 100kb default. Project payloads are small; 256kb is generous headroom.
const BODY_LIMIT = process.env["BODY_LIMIT"]?.trim() || "256kb";
// `reviver` strips __proto__/constructor/prototype keys from EVERY request body at parse
// time — the same guard lib/safe-json.ts applies to uploaded/imported JSON, but here for
// req.body itself, so no individual route can forget it. (express.urlencoded's qs parser
// already defaults allowPrototypes: false, so it needs no equivalent change.)
app.use(express.json({ limit: BODY_LIMIT, reviver: stripDangerousKeys }));
app.use(express.urlencoded({ extended: true, limit: BODY_LIMIT }));

// Dev-mode signalling: mark every response so a proxy/monitor/anyone can see this
// is a developer instance (never set in production — dev mode is gated off there).
if (isDevMode()) {
  app.use((_req, res, next) => {
    res.setHeader("X-OmniProject-Dev-Mode", "true");
    next();
  });
}

// Per-request timing: run the request inside a timing context the broker adds
// upstream wait to, and emit X-Omni-Upstream-Ms / X-Omni-Total-Ms so the gateway
// overhead can be separated from the broker → backend round-trip (load harness).
app.use((req, res, next) => {
  runWithTiming(() => {
    const start = Date.now();
    const origEnd = res.end.bind(res);
    res.end = ((...args: Parameters<typeof origEnd>) => {
      if (!res.headersSent) {
        const upstream = Math.round(getUpstreamMs());
        const total = Date.now() - start;
        res.setHeader("X-Omni-Upstream-Ms", String(upstream));
        res.setHeader("X-Omni-Total-Ms", String(total));
        // Standard Server-Timing so the browser's Performance API exposes the
        // gateway/upstream split natively (powers the dev-mode timing overlay and
        // shows up in devtools) — no fetch interception or custom-header CORS needed.
        res.setHeader(
          "Server-Timing",
          `upstream;dur=${upstream}, gateway;dur=${Math.max(0, total - upstream)}, total;dur=${total}`,
        );
      }
      return origEnd(...args);
    }) as typeof res.end;
    next();
  });
});

// RED metrics: count every request, its status class and latency, and track
// in-flight depth. Pure in-process counters → always available at /api/metrics
// even when the backend is down (exactly when you need them). Exposed via
// lib/runtime-metrics.ts.
app.use((req, res, next) => {
  const start = Date.now();
  httpRequestStarted();
  let recorded = false;
  const done = (): void => {
    if (recorded) return;
    recorded = true;
    recordHttpRequest(res.statusCode, Date.now() - start);
  };
  res.on("finish", done);
  res.on("close", done); // client aborted before finish
  next();
});

// Maintenance lockdown: under read-only mode, refuse mutating requests (auth + the toggle +
// health stay exempt so an admin can sign in and lift it). No-op unless engaged.
app.use(maintenanceGuard);

app.use("/api", router);

// Public security.txt (RFC 9116) — mounted before the SPA fallback so the
// history catch-all below doesn't swallow /.well-known/security.txt.
app.use(wellKnownRouter);

// ── Static SPA (single-container "omni-shell" mode) ───────────────────────────
// When STATIC_DIR points at the built frontend, this one server serves both the
// API (/api/*) and the SPA — matching the single port-3000 container that the
// docker-compose / k8s artifacts deploy. In dev the SPA runs under Vite and
// proxies /api here, so STATIC_DIR is left unset.
const staticDir = process.env["STATIC_DIR"];
if (staticDir && fs.existsSync(staticDir)) {
  // Resolve STATIC_DIR to absolute so the SPA history-fallback below serves the shell regardless of
  // whether STATIC_DIR was given as a relative or absolute path. In Express 5, `res.sendFile(absPath)`
  // rejects with a "Not Found" error (404) for every client-side route (e.g. /login) — the reliable
  // form is `res.sendFile(relative, { root: absDir })`, which we use below.
  const staticRoot = path.resolve(staticDir);
  // Vite emits content-hashed, immutable asset filenames, so they can be cached
  // forever — a big repeat-visit win. The shell entrypoints (index.html, the
  // service worker) must always revalidate so a new deploy is picked up at once.
  const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
  app.use(
    express.static(staticRoot, {
      maxAge: ONE_YEAR_MS,
      immutable: true,
      setHeaders(res, filePath) {
        if (filePath.endsWith("index.html") || filePath.endsWith("sw.js")) {
          res.setHeader("Cache-Control", "no-cache");
        }
      },
    }),
  );

  // SPA history fallback: serve index.html for non-API GET routes (never cached,
  // so it always references the latest hashed assets).
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api")) {
      next();
      return;
    }
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile("index.html", { root: staticRoot });
  });

  logger.info({ staticDir }, "Serving static SPA");
}

// Central error-capture seam — MUST be last so it catches anything thrown by a
// route. Fingerprints + structured-logs the error, counts it, and returns a safe
// generic 500 (never a stack trace). See lib/error-handler.ts.
app.use(errorHandler);

export default app;
