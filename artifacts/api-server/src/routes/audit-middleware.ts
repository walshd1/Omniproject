import type { Request, Response, NextFunction } from "express";
import { getSession } from "./auth";
import { roleForReq } from "../lib/rbac";
import { recordAudit, auditLevel } from "../lib/audit";
import { isDevMode } from "../lib/dev-mode";

/**
 * Audits every /api/* action at the configured level. Mounted after the rate
 * limiter and before the routers, so it captures reads + writes uniformly with
 * the resolved actor, status and latency. Health/ingest are mounted earlier and
 * are intentionally not audited (probe/ingest noise).
 */
export function auditMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (auditLevel() === "off") {
    next();
    return;
  }
  const start = Date.now();
  res.on("finish", () => {
    const session = getSession(req);
    const isAuth = req.path.startsWith("/auth");
    recordAudit({
      ts: new Date().toISOString(),
      category: isAuth ? "auth" : "request",
      action: `${req.method} /api${req.path}`,
      actor: session ? { sub: session.sub, email: session.email, role: roleForReq(req) } : null,
      status: res.statusCode,
      ms: Date.now() - start,
      ip: req.ip,
      write: ["POST", "PATCH", "PUT", "DELETE"].includes(req.method),
      // Tag every transaction performed on a dev/debug instance, so dev activity
      // (impersonation, entitlement overrides, spoofed brokers) is unmistakable in
      // the audit trail and can be filtered/excluded from real records.
      ...(isDevMode() ? { meta: { devMode: true } } : {}),
    });
  });
  next();
}
