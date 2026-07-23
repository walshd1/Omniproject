/*
 * Generic broker command passthrough (the command-palette edge).
 *
 * Route: POST /api/broker/command. Forwards an arbitrary action through the
 * neutral `brokerCommand()` seam helper — this route never imports a concrete
 * adapter, so the boundary holds with ZERO exceptions. See docs/BROKER.md.
 */
import { Router, type Request, type Response } from "express";
import { BrokerCommandBody } from "@workspace/api-zod";
import { contextFromReq, respondBrokerError, BrokerError, brokerCommand, brokerConfigured } from "../broker";
import { getSettings } from "../lib/settings";
import { requireRole } from "../lib/rbac";
import { guardProjectScope } from "../lib/project-scope";
import { getSession } from "./auth";
import { enforceCapability, CapabilityBlockedError, getCapability } from "../lib/capability-governance";
import { grantedCapabilitiesForReq } from "../lib/custom-roles";
import { enforceBusinessRules } from "../lib/ruleset-guard";

const router = Router();

// Forwarded actions that are DOMAIN writes of a rule-governed entity. These use the SAME action namespace
// as the typed routes' ruleset calls (create/update/delete_project, add_raid, …), so we can run the
// business ruleset on them at the seam — closing the bypass the header notes. Reads and opaque vendor
// commands aren't in this namespace, so they pass through untouched (and are governed by their own routes).
const DOMAIN_WRITE_ACTION = /^(create|update|delete)_(project|issue|issue_item|goal|invoice|task|timesheet)$|^(create_raid|add_raid|create_raid_entry)$/;

async function handle(req: Request, res: Response): Promise<void> {
  // This edge forwards an ARBITRARY action, including the most privileged writes the typed REST
  // routes reserve for `manager` (create/update/delete_project, RAID). It is gated at its most-
  // privileged forwardable action — `manager` — not `contributor` (which would let a contributor
  // forward manager-only actions and bypass those write walls). Forwarded DOMAIN writes additionally
  // run the PMO business ruleset (below), so the ruleset is no longer bypassed for them; opaque vendor
  // actions still pass through. The admin escape hatch remains routes/raw-api (admin + step-up +
  // RAW_API_ENABLED).
  if (!brokerConfigured()) {
    // No backend wired (demo mode, no admin-set broker URL): there is nothing to
    // forward to. Return the normalised "demo" error instead of attempting a live
    // n8n call that would surface as an opaque "backend unreachable".
    respondBrokerError(
      res,
      new BrokerError("unavailable", "No backend configured (demo mode): command passthrough requires a live broker"),
    );
    return;
  }

  const parse = BrokerCommandBody.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  const { action, source } = parse.data;

  // Vendor governance: when the active backend names a specific vendor, that vendor's
  // capability must be turned on (off by default). Denials are logged. When the source
  // is "all"/unknown we can't attribute to one vendor, so the gate is skipped.
  const vendorId = getSettings().backendSource?.trim();
  if (vendorId && getCapability(`vendor:${vendorId}`)) {
    try {
      const s = getSession(req);
      enforceCapability(`vendor:${vendorId}`, { actor: s ? { sub: s.sub, email: s.email } : null, granted: grantedCapabilitiesForReq(req) });
    } catch (err) {
      if (err instanceof CapabilityBlockedError) {
        respondBrokerError(res, new BrokerError("unavailable", `Vendor "${vendorId}" is turned off by the administrator`));
        return;
      }
      throw err;
    }
  }

  // Never trust client-supplied identity. Strip any userContext/origin from the
  // raw body; the server injects identity from the validated OIDC session.
  const rawPayload = (parse.data.payload ?? {}) as Record<string, unknown>;
  const { userContext: _ignoredUserContext, origin: _ignoredOrigin, ...payload } = rawPayload;

  // IDOR guard: this edge forwards a caller-supplied `projectId` straight to the scope-blind broker
  // (which only enforces scope on listProjects/updateProject). Without a gateway check a programme/
  // user-scoped manager could read or mutate ANY project by naming its id here — the same hole the
  // typed per-project routes and the MCP channel already close (mcp.ts:141-144). Re-derive scope at
  // the gateway; out-of-scope ⇒ 403, not served.
  const projectId = payload["projectId"];
  if (typeof projectId === "string" && projectId) {
    if (!(await guardProjectScope(req, res, projectId))) return;
  }

  // Business ruleset on forwarded domain writes (the header's acknowledged bypass). Runs AFTER the
  // manager gate + IDOR scope check; a hard block is 422, warnings ride the response header.
  if (DOMAIN_WRITE_ACTION.test(action) && !enforceBusinessRules(req, res, action, { projectId: typeof projectId === "string" ? projectId : null, payload })) return;

  try {
    const result = await brokerCommand(contextFromReq(req), action, payload, source ?? "unknown");
    res.json(result);
  } catch (err: unknown) {
    req.log.error({ err, action }, "broker command failed");
    respondBrokerError(res, err);
  }
}

router.post("/broker/command", requireRole("manager"), handle);

export default router;
