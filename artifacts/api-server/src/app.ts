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

const SESSION_SECRET =
  process.env["SESSION_SECRET"] || "omniproject-dev-secret-change-in-production";

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
app.use(cookieParser(SESSION_SECRET));
// Stash the raw request bytes so payment-webhook routes can verify provider
// signatures (e.g. Stripe signs the exact body). Cheap; only the buffer is kept.
const keepRaw = (req: express.Request, _res: express.Response, buf: Buffer) => {
  (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
};
app.use(express.json({ verify: keepRaw }));
app.use(express.urlencoded({ extended: true, verify: keepRaw }));

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
