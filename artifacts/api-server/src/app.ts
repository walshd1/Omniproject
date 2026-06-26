import path from "node:path";
import fs from "node:fs";
import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

// Honour X-Forwarded-* headers (Traefik / k8s ingress) so OIDC redirect URIs
// and secure-cookie detection resolve to the public origin.
app.set("trust proxy", true);

// The session-cookie signing key. In production it MUST come from the
// environment: an unset/empty/default value would sign auth cookies with a
// world-readable constant, making sessions and roles forgeable (see
// security.test.ts, which mints an admin session from a known secret). So we
// fail fast rather than boot silently-insecure. The dev default is only ever
// used outside production, where convenience beats hardening.
const DEV_SESSION_SECRET = "omniproject-dev-secret-change-in-production";
const SESSION_SECRET = resolveSessionSecret();

function resolveSessionSecret(): string {
  const fromEnv = process.env["SESSION_SECRET"]?.trim();
  if (process.env["NODE_ENV"] === "production") {
    if (!fromEnv || fromEnv === DEV_SESSION_SECRET) {
      throw new Error(
        "SESSION_SECRET must be set to a strong, non-default value in production " +
          "(the gateway refuses to boot otherwise so sessions can't be signed with a public key).",
      );
    }
    return fromEnv;
  }
  return fromEnv || DEV_SESSION_SECRET;
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
app.use(cors());

// Baseline security headers on every response (API + SPA). Deliberately
// conservative — no CSP here (it would need per-deployment tuning for the SPA's
// font/asset origins); these are the safe, universally-applicable ones.
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-DNS-Prefetch-Control", "off");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  // HSTS only over HTTPS in production (meaningless/counterproductive on plain http).
  if (process.env["NODE_ENV"] === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
});

app.use(cookieParser(SESSION_SECRET));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// ── Static SPA (single-container "omni-shell" mode) ───────────────────────────
// When STATIC_DIR points at the built frontend, this one server serves both the
// API (/api/*) and the SPA — matching the single port-3000 container that the
// docker-compose / k8s artifacts deploy. In dev the SPA runs under Vite and
// proxies /api here, so STATIC_DIR is left unset.
const staticDir = process.env["STATIC_DIR"];
if (staticDir && fs.existsSync(staticDir)) {
  const indexHtml = path.join(staticDir, "index.html");
  app.use(express.static(staticDir));

  // SPA history fallback: serve index.html for non-API GET routes.
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api")) {
      next();
      return;
    }
    res.sendFile(indexHtml);
  });

  logger.info({ staticDir }, "Serving static SPA");
}

export default app;
