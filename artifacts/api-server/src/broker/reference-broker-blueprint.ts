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
  /** Dedup token — a provider MAY use it to collapse duplicate triggers. */
  idempotencyKey?: string;
  /** Loop-guard origin tag. A provider SHOULD echo it on emitted events. */
  origin?: string;
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

/** The backend interface a broker implements (the stub above is one). Templates
 *  type their real implementation against this. */
export type BrokerBackend = typeof backend;

/** Route one binding action to the backend. The single switch a broker owns. The
 *  backend is injected so every transport template reuses this unchanged. */
async function dispatch(action: string, payload: Row, ctx: ActorCtx, be: BrokerBackend): Promise<unknown> {
  const pid = String(payload["projectId"] ?? "");
  const iid = String(payload["issueId"] ?? "");
  switch (action) {
    case "list_projects": return be.listProjects(ctx);
    case "list_issues": return be.listIssues(ctx, pid);
    case "get_issue": return be.getIssue(ctx, pid, iid);
    case "list_project_members": return be.listProjectMembers(ctx, pid);
    case "list_task_items": return be.listTaskItems(ctx, pid, String(payload["taskId"] ?? ""));
    case "project_summary": return be.projectSummary(ctx, pid);
    case "get_project_history": return be.projectHistory(ctx, pid);
    case "get_baseline": return be.baseline(ctx, pid);
    case "get_raid": return be.raid(ctx, pid);
    case "get_notifications": return be.notifications(ctx);
    case "get_portfolio_health": return be.portfolioHealth(ctx);
    case "get_resource_capacity": return be.resourceCapacity(ctx, pid);
    case "get_project_financials": return be.projectFinancials(ctx, pid);
    case "get_capabilities": return be.capabilities(ctx);
    case "get_fx_rates": return be.fxRates(ctx);
    case "replay": return be.replay(ctx, payload["from"] as string, payload["to"] as string);
    case "list_activity": return be.activity(ctx);
    case "create_project": return be.createProject(ctx, payload);
    case "update_project": return be.updateProject(ctx, pid, payload);
    case "create_issue": return be.createIssue(ctx, pid, payload);
    case "update_issue": return be.updateIssue(ctx, pid, iid, payload);
    case "delete_issue": return be.deleteIssue(ctx, pid, iid);
    case "create_raid_entry": return be.createRaidEntry(ctx, pid, payload);
    case "create_task_item": return be.createTaskItem(ctx, pid, String(payload["taskId"] ?? ""), payload);
    default:
      // Unknown action — a bad request, not a server error.
      throw new BrokerHttpError(400, { success: false, message: `unknown action: ${action}` });
  }
}

/** The transport-agnostic BROKER CORE: parse (incl. PSK) → extract actor → verify
 *  short-circuit → dispatch → response envelope + error taxonomy. Every transport
 *  template (Node HTTP, serverless, Pipedream, …) calls THIS and only supplies the
 *  platform glue + its `backend`, so there is no duplication of the binding logic. */
export interface BrokerCoreInput {
  /** The raw request body string. */
  rawBody: string;
  /** Optional `X-OmniProject-Action` header value. */
  actionHeader?: string;
  /** Optional `Authorization` header value (per-user impersonation). */
  authHeader?: string;
}
export interface BrokerCoreResult {
  status: number;
  body: unknown;
  /** True when the request arrived PSK-encrypted — the transport SHOULD encrypt
   *  the response the same way (symmetric wire format). */
  encrypted: boolean;
}

/** Core broker call: parse (decrypting a PSK envelope), route the action, return the result. */
export async function processBrokerCall(input: BrokerCoreInput, be: BrokerBackend = backend): Promise<BrokerCoreResult> {
  // 1. Parse the body (decrypting a PSK envelope first if present).
  let body: Row;
  let encrypted = false;
  try {
    let json: Row = input.rawBody ? (JSON.parse(input.rawBody) as Row) : {};
    if (typeof json["enc"] === "string") {
      const opened = openPsk(json["enc"] as string);
      if (opened === null) return { status: 400, body: { success: false, message: "bad PSK envelope" }, encrypted: false };
      json = JSON.parse(opened) as Row;
      encrypted = true;
    }
    body = json;
  } catch {
    return { status: 400, body: { success: false, message: "invalid JSON" }, encrypted: false };
  }

  // 2. Extract action + the FULL control surface (a provider shouldn't be
  //    neutered — it gets the actor, source routing, idempotency + origin).
  const action = String(input.actionHeader || body["action"] || "");
  const payload = (body["payload"] as Row) ?? {};
  const userContext = (payload["userContext"] as Row | undefined) ?? undefined;
  const authHeader = input.authHeader ?? (body["auth"] as string | undefined);
  const ctx: ActorCtx = {
    token: (userContext?.["token"] as string | undefined) ?? authHeader?.replace(/^Bearer\s+/i, ""),
    sub: userContext?.["sub"] as string | undefined,
    role: userContext?.["role"] as string | undefined,
    source: body["source"] as string | undefined,
    idempotencyKey: body["idempotencyKey"] as string | undefined,
    origin: body["origin"] as string | undefined,
  };

  // 3. `verify` short-circuit: a dry-run probe must NOT touch the backend.
  if (body["verify"] === true || payload["verify"] === true) {
    return { status: 200, body: { success: true, data: { action, verified: true }, message: "verify ok" }, encrypted };
  }

  // 4. Dispatch + map results/errors onto the envelope + taxonomy.
  try {
    const data = await dispatch(action, payload, ctx, be);
    return { status: 200, body: { success: true, data, message: null }, encrypted };
  } catch (e) {
    if (e instanceof NotImplemented) return { status: 501, body: { success: false, message: e.message }, encrypted };
    const err = e as BrokerHttpError;
    return { status: typeof err?.status === "number" ? err.status : 500, body: err.body ?? { success: false, message: "error" }, encrypted };
  }
}

/** Sign an outbound event body: `sha256=<hex HMAC>` over the exact serialised
 *  body, using the subscription secret. (Delivery itself is yours to wire up.) */
export function signEvent(body: string, secret: string): string {
  return "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
}

/** Build (but don't start) the blueprint HTTP server — a thin Node-HTTP adapter
 *  over `processBrokerCall`. (The serverless / Pipedream templates are the same
 *  few lines for their platform — see broker/templates/.) */
export function createReferenceBrokerBlueprint(): http.Server {
  return http.createServer((req, res) => {
    if (req.method !== "POST") { res.writeHead(405).end(); return; }
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      void processBrokerCall({
        rawBody: raw,
        actionHeader: req.headers["x-omniproject-action"] as string | undefined,
        authHeader: req.headers["authorization"] as string | undefined,
      }).then((r) => {
        res.writeHead(r.status, { "Content-Type": "application/json", "X-OmniProject-Origin": "omniproject" });
        res.end(JSON.stringify(r.body));
      });
    });
  });
}

// Runnable ONLY to prove it boots — every real action returns 501 until you
// implement `backend`. `tsx src/broker/reference-broker-blueprint.ts`
if (process.argv[1]?.endsWith("reference-broker-blueprint.ts")) {
  const port = Number(process.env["PORT"]) || 5702;
  createReferenceBrokerBlueprint().listen(port, () => console.log(`Reference broker BLUEPRINT on :${port} — implement backend.* (every action is 501 until you do).`));
}
