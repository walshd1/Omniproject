/**
 * REFERENCE BROKER BLUEPRINT — a functionally COMPLETE design that is
 * deliberately NON-FUNCTIONAL.
 *
 * This is the teaching scaffold for writing your own broker. It implements the
 * ENTIRE binding surface correctly — envelope parsing, optional PSK decryption,
 * the `verify` short-circuit, per-user auth extraction, the full action router,
 * the response envelope, the HTTP error taxonomy (incl. 409 optimistic
 * concurrency), and outbound HMAC event signing — EXCEPT the one thing only you
 * can write: the calls to YOUR system of record. Every data operation in
 * `backend` throws `NotImplemented`.
 *
 * Why intentionally non-functional: so it can't be `docker run`-and-forgotten.
 * It's a correct skeleton you COMPLETE, not a product you deploy. Two siblings:
 *   - reference-sidecar.ts — a RUNNABLE in-memory broker (CI conformance fixture).
 *   - this file            — the COMPLETE-but-stubbed design to implement against.
 *
 * To make it real: replace each `backend.*` body with a call to your backend,
 * normalising the result to the contract shapes (docs/BROKER-HTTP-BINDING.md),
 * then run the conformance suite and point BROKER_URL at it.
 */
import http from "node:http";
import crypto from "node:crypto";

type Row = Record<string, unknown>;

/** The authenticated caller, extracted from the request (forward this to your
 *  backend so IT authorises — the gateway only gates its own actions). */
export interface ActorCtx {
  /** The end user's forwarded bearer token (per-user impersonation). */
  token?: string;
  sub?: string;
  role?: string;
  /** Backend routing hint (which system of record), from the `source` field. */
  source?: string;
}

/** Thrown by every unimplemented backend operation. Maps to HTTP 501. */
export class NotImplemented extends Error {
  constructor(op: string) {
    super(`backend.${op}() is not implemented — wire it to your system of record`);
    this.name = "NotImplemented";
  }
}

/** A typed HTTP error your backend code throws to drive the taxonomy (e.g.
 *  `throw new BrokerHttpError(409, currentRow)` on a version conflict). */
export class BrokerHttpError extends Error {
  constructor(readonly status: number, readonly body?: unknown) {
    super(`broker http ${status}`);
    this.name = "BrokerHttpError";
  }
}

// ════════════════════════════════════════════════════════════════════════════
// IMPLEMENT THIS — your system of record. Every method is a stub: replace the
// body with a real call to your backend's API and normalise the result to the
// OmniProject contract shape. Throw BrokerHttpError(404/409/401/…) to drive the
// error taxonomy; honour `payload.expectedVersion` → 409 with the current row.
// ════════════════════════════════════════════════════════════════════════════
export const backend = {
  async listProjects(_ctx: ActorCtx): Promise<Row[]> { throw new NotImplemented("listProjects"); },
  async listIssues(_ctx: ActorCtx, _projectId: string): Promise<Row[]> { throw new NotImplemented("listIssues"); },
  async getIssue(_ctx: ActorCtx, _projectId: string, _issueId: string): Promise<Row | null> { throw new NotImplemented("getIssue"); },
  async listProjectMembers(_ctx: ActorCtx, _projectId: string): Promise<Row[]> { throw new NotImplemented("listProjectMembers"); },
  async listTaskItems(_ctx: ActorCtx, _projectId: string, _taskId: string): Promise<Row[]> { throw new NotImplemented("listTaskItems"); },
  async projectSummary(_ctx: ActorCtx, _projectId: string): Promise<Row> { throw new NotImplemented("projectSummary"); },
  async projectHistory(_ctx: ActorCtx, _projectId: string): Promise<Row[]> { throw new NotImplemented("projectHistory"); },
  async baseline(_ctx: ActorCtx, _projectId: string): Promise<Row | null> { throw new NotImplemented("baseline"); },
  async raid(_ctx: ActorCtx, _projectId: string): Promise<Row[]> { throw new NotImplemented("raid"); },
  async portfolioHealth(_ctx: ActorCtx): Promise<Row[]> { throw new NotImplemented("portfolioHealth"); },
  async resourceCapacity(_ctx: ActorCtx, _projectId: string): Promise<Row[]> { throw new NotImplemented("resourceCapacity"); },
  async projectFinancials(_ctx: ActorCtx, _projectId: string): Promise<Row> { throw new NotImplemented("projectFinancials"); },
  async notifications(_ctx: ActorCtx): Promise<Row[]> { throw new NotImplemented("notifications"); },
  async capabilities(_ctx: ActorCtx): Promise<Row> { throw new NotImplemented("capabilities"); },
  async fxRates(_ctx: ActorCtx): Promise<Row> { throw new NotImplemented("fxRates"); },
  async replay(_ctx: ActorCtx, _from?: string, _to?: string): Promise<Row[]> { throw new NotImplemented("replay"); },
  async activity(_ctx: ActorCtx): Promise<Row[]> { throw new NotImplemented("activity"); },
  // Writes — honour optimistic concurrency on update (expectedVersion → 409).
  async createProject(_ctx: ActorCtx, _input: Row): Promise<Row> { throw new NotImplemented("createProject"); },
  async updateProject(_ctx: ActorCtx, _projectId: string, _input: Row): Promise<Row> { throw new NotImplemented("updateProject"); },
  async createIssue(_ctx: ActorCtx, _projectId: string, _input: Row): Promise<Row> { throw new NotImplemented("createIssue"); },
  async updateIssue(_ctx: ActorCtx, _projectId: string, _issueId: string, _input: Row): Promise<Row> { throw new NotImplemented("updateIssue"); },
  async deleteIssue(_ctx: ActorCtx, _projectId: string, _issueId: string): Promise<null> { throw new NotImplemented("deleteIssue"); },
  async createRaidEntry(_ctx: ActorCtx, _projectId: string, _input: Row): Promise<Row> { throw new NotImplemented("createRaidEntry"); },
  async createTaskItem(_ctx: ActorCtx, _projectId: string, _taskId: string, _input: Row): Promise<Row> { throw new NotImplemented("createTaskItem"); },
};

// ════════════════════════════════════════════════════════════════════════════
// CONTRACT PLUMBING — complete; you shouldn't need to change anything below.
// ════════════════════════════════════════════════════════════════════════════

const PSK_PREFIX = "p1.";

/** Optional PSK: decrypt a sealed envelope (mirror of the gateway's sealer). When
 *  BROKER_PSK is set and the body is `{ v, enc }`, return the decrypted JSON. */
function openPsk(token: string): string | null {
  const secret = process.env["BROKER_PSK"]?.trim();
  if (!secret || !token.startsWith(PSK_PREFIX)) return null;
  try {
    const key = crypto.createHash("sha256").update(secret).digest();
    const buf = Buffer.from(token.slice(PSK_PREFIX.length), "base64url");
    const iv = buf.subarray(0, 12), tag = buf.subarray(12, 28), ct = buf.subarray(28);
    const d = crypto.createDecipheriv("aes-256-gcm", key, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** Route one binding action to the backend. The single switch a broker owns. */
async function dispatch(action: string, payload: Row, ctx: ActorCtx): Promise<unknown> {
  const pid = String(payload["projectId"] ?? "");
  const iid = String(payload["issueId"] ?? "");
  switch (action) {
    case "list_projects": return backend.listProjects(ctx);
    case "list_issues": return backend.listIssues(ctx, pid);
    case "get_issue": return backend.getIssue(ctx, pid, iid);
    case "list_project_members": return backend.listProjectMembers(ctx, pid);
    case "list_task_items": return backend.listTaskItems(ctx, pid, String(payload["taskId"] ?? ""));
    case "project_summary": return backend.projectSummary(ctx, pid);
    case "get_project_history": return backend.projectHistory(ctx, pid);
    case "get_baseline": return backend.baseline(ctx, pid);
    case "get_raid": return backend.raid(ctx, pid);
    case "get_notifications": return backend.notifications(ctx);
    case "get_portfolio_health": return backend.portfolioHealth(ctx);
    case "get_resource_capacity": return backend.resourceCapacity(ctx, pid);
    case "get_project_financials": return backend.projectFinancials(ctx, pid);
    case "get_capabilities": return backend.capabilities(ctx);
    case "get_fx_rates": return backend.fxRates(ctx);
    case "replay": return backend.replay(ctx, payload["from"] as string, payload["to"] as string);
    case "list_activity": return backend.activity(ctx);
    case "create_project": return backend.createProject(ctx, payload);
    case "update_project": return backend.updateProject(ctx, pid, payload);
    case "create_issue": return backend.createIssue(ctx, pid, payload);
    case "update_issue": return backend.updateIssue(ctx, pid, iid, payload);
    case "delete_issue": return backend.deleteIssue(ctx, pid, iid);
    case "create_raid_entry": return backend.createRaidEntry(ctx, pid, payload);
    case "create_task_item": return backend.createTaskItem(ctx, pid, String(payload["taskId"] ?? ""), payload);
    default:
      // Unknown action — a bad request, not a server error.
      throw new BrokerHttpError(400, { success: false, message: `unknown action: ${action}` });
  }
}

/** Sign an outbound event body: `sha256=<hex HMAC>` over the exact serialised
 *  body, using the subscription secret. (Delivery itself is yours to wire up.) */
export function signEvent(body: string, secret: string): string {
  return "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
}

/** Build (but don't start) the blueprint HTTP server. */
export function createReferenceBrokerBlueprint(): http.Server {
  return http.createServer((req, res) => {
    if (req.method !== "POST") { res.writeHead(405).end(); return; }
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      void (async () => {
        // 1. Parse the body (decrypting a PSK envelope first if present).
        let body: Row = {};
        try {
          let json: Row = raw ? (JSON.parse(raw) as Row) : {};
          if (typeof json["enc"] === "string") {
            const opened = openPsk(json["enc"] as string);
            if (opened === null) { res.writeHead(400).end(); return; }
            json = JSON.parse(opened) as Row;
          }
          body = json;
        } catch { res.writeHead(400).end(); return; }

        // 2. Extract action + the authenticated actor (forward, never store).
        const action = String((req.headers["x-omniproject-action"] as string) || body["action"] || "");
        const payload = (body["payload"] as Row) ?? {};
        const userContext = (payload["userContext"] as Row | undefined) ?? undefined;
        const authHeader = (req.headers["authorization"] as string | undefined) ?? (body["auth"] as string | undefined);
        const ctx: ActorCtx = {
          token: userContext?.["token"] as string | undefined ?? authHeader?.replace(/^Bearer\s+/i, ""),
          sub: userContext?.["sub"] as string | undefined,
          role: userContext?.["role"] as string | undefined,
          source: body["source"] as string | undefined,
        };

        // 3. `verify` short-circuit: a dry-run probe must NOT touch the backend.
        if (body["verify"] === true || payload["verify"] === true) {
          res.writeHead(200, { "Content-Type": "application/json", "X-OmniProject-Origin": "omniproject" });
          res.end(JSON.stringify({ success: true, data: { action, verified: true }, message: "verify ok" }));
          return;
        }

        // 4. Dispatch + map results/errors onto the response envelope + taxonomy.
        try {
          const data = await dispatch(action, payload, ctx);
          res.writeHead(200, { "Content-Type": "application/json", "X-OmniProject-Origin": "omniproject" });
          res.end(JSON.stringify({ success: true, data, message: null }));
        } catch (e) {
          if (e instanceof NotImplemented) {
            // 501 — honest "this broker isn't built yet" (the whole point).
            res.writeHead(501, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, message: e.message }));
            return;
          }
          const err = e as BrokerHttpError;
          const status = typeof err?.status === "number" ? err.status : 500;
          res.writeHead(status, { "Content-Type": "application/json" });
          res.end(JSON.stringify(err.body ?? { success: false, message: "error" }));
        }
      })();
    });
  });
}

// Runnable ONLY to prove it boots — every real action returns 501 until you
// implement `backend`. `tsx src/broker/reference-broker-blueprint.ts`
if (process.argv[1]?.endsWith("reference-broker-blueprint.ts")) {
  const port = Number(process.env["PORT"]) || 5702;
  createReferenceBrokerBlueprint().listen(port, () => console.log(`Reference broker BLUEPRINT on :${port} — implement backend.* (every action is 501 until you do).`));
}
