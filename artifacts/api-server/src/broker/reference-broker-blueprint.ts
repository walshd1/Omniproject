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
import { openPayload } from "../lib/broker-psk";
import { safeParseJson } from "../lib/safe-json";
import { verifyBrokerRequest, signBrokerResponse, type CanonicalRequest } from "../lib/broker-hmac";
import type { SessionBind } from "../lib/session-key";

type Row = Record<string, unknown>;

/** The authenticated caller, extracted from the request (forward this to your
 *  backend so IT authorises — the gateway only gates its own actions). */
export interface ActorCtx {
  /** The end user's forwarded bearer token (per-user impersonation). */
  token?: string | undefined;
  sub?: string | undefined;
  role?: string | undefined;
  /** Backend routing hint (which system of record), from the `source` field. */
  source?: string | undefined;
  /** Dedup token — a provider MAY use it to collapse duplicate triggers. */
  idempotencyKey?: string | undefined;
  /** Loop-guard origin tag. A provider SHOULD echo it on emitted events. */
  origin?: string | undefined;
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
  async fxRates(_ctx: ActorCtx, _asOf?: string): Promise<Row> { throw new NotImplemented("fxRates"); },
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

/** Optional PSK: decrypt a sealed envelope. Delegates to the shared opener, which accepts
 *  the current `p2.` (HKDF domain-separated key) and legacy `p1.` (bare SHA-256) tokens.
 *  Returns null when PSK is off or the token isn't ours. A real out-of-process broker
 *  vendors an equivalent opener — see docs/BROKER-HTTP-BINDING.md §2a. */
function openPsk(token: string): string | null {
  if (!process.env["BROKER_PSK"]?.trim()) return null;
  try {
    return openPayload(token);
  } catch {
    return null;
  }
}

/** A single header value (Node lower-cases header names; a repeated header is an array). */
function hdr(headers: Record<string, string | string[] | undefined> | undefined, name: string): string | undefined {
  const v = headers?.[name];
  return Array.isArray(v) ? v[0] : v;
}

/** Reconstruct the session binding from the cleartext `X-Omni-Bind-*` headers (used only on
 *  an UNSEALED hop; under PSK the binding rides inside the ciphertext instead). */
function bindFromHeaders(headers: Record<string, string | string[] | undefined> | undefined): SessionBind | undefined {
  const sub = hdr(headers, "x-omni-bind-sub");
  if (!sub) return undefined;
  const kver = hdr(headers, "x-omni-bind-kver");
  return { sub, smono: hdr(headers, "x-omni-bind-mono") ?? "", salt: hdr(headers, "x-omni-bind-salt") ?? "", bkver: kver ? Number(kver) : undefined };
}

/** The backend interface a broker implements (the stub above is one). Templates
 *  type their real implementation against this.
 *
 *  The core is the stub's shape PLUS an OPTIONAL Jira-class collaboration surface
 *  (comments) a backend MAY implement. Optional — not on the stub — so no existing
 *  implementer is forced to add it; a backend that stores comments first-class (e.g.
 *  OmniStore) implements the methods and a backend that doesn't omits them, exactly
 *  like the gateway `Broker`'s optional methods. The matching binding actions
 *  presence-check and return 501 when absent (capability-gated). */
export type BrokerBackend = typeof backend & {
  /** OPTIONAL — a work item's comment thread, newest-last. Only a backend that stores comments
   *  first-class implements it (else the `list_task_comments` action is 501). */
  listTaskComments?(ctx: ActorCtx, issueId: string): Promise<Row[]>;
  /** OPTIONAL — append a comment to a work item. `input.body` is the text; the backend stamps
   *  id/author/createdAt. Only a comment-storing backend implements it (else `add_task_comment` is 501). */
  addTaskComment?(ctx: ActorCtx, issueId: string, input: Row): Promise<Row>;
  /** OPTIONAL — a work item's attachment REFERENCES (filename/url/contentType/size), never the bytes
   *  (OmniProject is zero-at-rest). Only a backend that tracks attachment refs implements it (else the
   *  `list_task_attachments` action is 501). */
  listTaskAttachments?(ctx: ActorCtx, issueId: string): Promise<Row[]>;
  /** OPTIONAL — record an attachment REFERENCE on a work item (a pointer to where the file actually
   *  lives; the backend stamps id/addedBy/addedAt). Only an attachment-tracking backend implements it
   *  (else `add_task_attachment` is 501). */
  addTaskAttachment?(ctx: ActorCtx, issueId: string, input: Row): Promise<Row>;
};

/** The pre-extracted call context handed to every binding action's handler. */
interface BindingCtx {
  be: BrokerBackend;
  ctx: ActorCtx;
  payload: Row;
  /** `projectId` from the payload (or ""). */
  pid: string;
  /** `issueId` from the payload (or ""). */
  iid: string;
}

/**
 * The canonical BINDING-ACTION registry — every action a broker can route, keyed by
 * action name to the backend call it makes. This is the single source of the
 * binding vocabulary (was a switch); a transport template reuses it unchanged, and
 * the conformance/contract suites + the MCP guard validate against its key set so
 * the action vocabulary can't drift across the seam.
 */
const BINDING_ACTIONS: Record<string, (b: BindingCtx) => unknown> = {
  list_projects: ({ be, ctx }) => be.listProjects(ctx),
  list_issues: ({ be, ctx, pid }) => be.listIssues(ctx, pid),
  get_issue: ({ be, ctx, pid, iid }) => be.getIssue(ctx, pid, iid),
  list_project_members: ({ be, ctx, pid }) => be.listProjectMembers(ctx, pid),
  list_task_items: ({ be, ctx, pid, payload }) => be.listTaskItems(ctx, pid, String(payload["taskId"] ?? "")),
  project_summary: ({ be, ctx, pid }) => be.projectSummary(ctx, pid),
  get_project_history: ({ be, ctx, pid }) => be.projectHistory(ctx, pid),
  get_baseline: ({ be, ctx, pid }) => be.baseline(ctx, pid),
  get_raid: ({ be, ctx, pid }) => be.raid(ctx, pid),
  get_notifications: ({ be, ctx }) => be.notifications(ctx),
  get_portfolio_health: ({ be, ctx }) => be.portfolioHealth(ctx),
  get_resource_capacity: ({ be, ctx, pid }) => be.resourceCapacity(ctx, pid),
  get_project_financials: ({ be, ctx, pid }) => be.projectFinancials(ctx, pid),
  get_capabilities: ({ be, ctx }) => be.capabilities(ctx),
  get_fx_rates: ({ be, ctx, payload }) => be.fxRates(ctx, payload["asOf"] as string | undefined),
  replay: ({ be, ctx, payload }) => be.replay(ctx, payload["from"] as string, payload["to"] as string),
  list_activity: ({ be, ctx }) => be.activity(ctx),
  create_project: ({ be, ctx, payload }) => be.createProject(ctx, payload),
  update_project: ({ be, ctx, pid, payload }) => be.updateProject(ctx, pid, payload),
  create_issue: ({ be, ctx, pid, payload }) => be.createIssue(ctx, pid, payload),
  update_issue: ({ be, ctx, pid, iid, payload }) => be.updateIssue(ctx, pid, iid, payload),
  delete_issue: ({ be, ctx, pid, iid }) => be.deleteIssue(ctx, pid, iid),
  create_raid_entry: ({ be, ctx, pid, payload }) => be.createRaidEntry(ctx, pid, payload),
  create_task_item: ({ be, ctx, pid, payload }) => be.createTaskItem(ctx, pid, String(payload["taskId"] ?? ""), payload),
  // OPTIONAL Jira-class comments — presence-gated: a backend that doesn't store comments has no
  // handler method, so the action returns 501 (NotImplemented) rather than silently no-op'ing.
  list_task_comments: ({ be, ctx, iid }) => {
    if (!be.listTaskComments) throw new NotImplemented("listTaskComments");
    return be.listTaskComments(ctx, iid);
  },
  add_task_comment: ({ be, ctx, iid, payload }) => {
    if (!be.addTaskComment) throw new NotImplemented("addTaskComment");
    return be.addTaskComment(ctx, iid, payload);
  },
  // OPTIONAL Jira-class attachment REFERENCES — presence-gated, same contract as comments.
  list_task_attachments: ({ be, ctx, iid }) => {
    if (!be.listTaskAttachments) throw new NotImplemented("listTaskAttachments");
    return be.listTaskAttachments(ctx, iid);
  },
  add_task_attachment: ({ be, ctx, iid, payload }) => {
    if (!be.addTaskAttachment) throw new NotImplemented("addTaskAttachment");
    return be.addTaskAttachment(ctx, iid, payload);
  },
};

/** The canonical set of binding action names (the registry's keys). */
export const BINDING_ACTION_NAMES: readonly string[] = Object.keys(BINDING_ACTIONS);

/**
 * The transport-security versions THIS broker supports, advertised in the `protocol` field of the
 * `get_capabilities` reply. The gateway reads it to detect a broker that DOESN'T verify v2 request
 * signatures (so signing would buy nothing) and warn — a safety net when an operator points the
 * gateway at a broker that hasn't implemented the v2 seam. A broker that omits it reads as v1-only.
 */
export const BROKER_PROTOCOL_SUPPORT = { psk: ["p1", "p2"], sig: ["v2"], resp: ["v2"] } as const;

/** Route one binding action to the backend via the registry. The backend is
 *  injected so every transport template reuses this unchanged. */
async function dispatch(action: string, payload: Row, ctx: ActorCtx, be: BrokerBackend): Promise<unknown> {
  // Resolve the handler as an OWN property only. BINDING_ACTIONS is a plain object literal, so it
  // inherits Object.prototype — a bare `BINDING_ACTIONS[action]` would let an action of "constructor"
  // / "toString" / "valueOf" / "hasOwnProperty" resolve to an inherited method, pass the truthy
  // `if (!handler)` check, and get INVOKED (e.g. "constructor" echoes the {be,ctx,payload} argument
  // straight back into the response envelope; others throw a 500) instead of the intended clean 400.
  // Object.hasOwn gates the dynamic call to the registered action vocabulary and nothing else.
  const handler = Object.hasOwn(BINDING_ACTIONS, action) ? BINDING_ACTIONS[action] : undefined;
  if (!handler) {
    // Unknown action — a bad request, not a server error.
    throw new BrokerHttpError(400, { success: false, message: `unknown action: ${action}` });
  }
  return handler({ be, ctx, payload, pid: String(payload["projectId"] ?? ""), iid: String(payload["issueId"] ?? "") });
}

/** The transport-agnostic BROKER CORE: parse (incl. PSK) → extract actor → verify
 *  short-circuit → dispatch → response envelope + error taxonomy. Every transport
 *  template (Node HTTP, serverless, Pipedream, …) calls THIS and only supplies the
 *  platform glue + its `backend`, so there is no duplication of the binding logic. */
export interface BrokerCoreInput {
  /** The raw request body string. */
  rawBody: string;
  /** Optional `X-OmniProject-Action` header value. */
  actionHeader?: string | undefined;
  /** Optional `Authorization` header value (per-user impersonation). */
  authHeader?: string | undefined;
  /** All request headers (lower-cased) — the core reads the `X-Omni-*` signature +
   *  routing headers from here to VERIFY the request. Omit to skip verification. */
  headers?: Record<string, string | string[] | undefined> | undefined;
}
export interface BrokerCoreResult {
  status: number;
  body: unknown;
  /** True when the request arrived PSK-encrypted — the transport SHOULD encrypt
   *  the response the same way (symmetric wire format). */
  encrypted: boolean;
  /** The request's session binding (or undefined for a static-key call), echoed so the transport
   *  can SIGN the response under the same key the request used (broker→gateway response signing). */
  bind?: SessionBind | undefined;
}

/** Core broker call: parse (decrypting a PSK envelope), route the action, return the result. */
export async function processBrokerCall(input: BrokerCoreInput, be: BrokerBackend = backend): Promise<BrokerCoreResult> {
  // 1. Parse the body (decrypting a PSK envelope first if present).
  let body: Row;
  let encrypted = false;
  // The session binding lifted out of a sealed envelope (F2) — present only when PSK is on
  // and the caller was session-bound; used to re-key the signature check below.
  let sealedBind: SessionBind | undefined;
  try {
    // safeParseJson (prototype-safe reviver) — this standalone server does NOT go through express's
    // stripping reviver, and the parsed body flows into Object.assign(row, input) below the seam, so a
    // `__proto__`/`constructor` key would otherwise pollute the stored row's prototype.
    let json: Row = input.rawBody ? safeParseJson<Row>(input.rawBody) : {};
    if (typeof json["enc"] === "string") {
      const opened = openPsk(json["enc"] as string);
      if (opened === null) return { status: 400, body: { success: false, message: "bad PSK envelope" }, encrypted: false };
      json = safeParseJson<Row>(opened);
      encrypted = true;
      if (json["__bind"] && typeof json["__bind"] === "object") sealedBind = json["__bind"] as SessionBind;
      delete json["__bind"]; // internal transport field — never surface it to the backend
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
  // The binding this request was keyed under (sealed __bind under PSK, else the cleartext headers).
  // Reused to verify the request signature AND to sign the response under the same key.
  const requestBind = encrypted ? sealedBind : bindFromHeaders(input.headers);

  // 3. `verify` short-circuit: a dry-run probe must NOT touch the backend (and is
  //    unauthenticated by design — connectivity, not authorisation), so it runs BEFORE
  //    the signature check and a readiness/verify ping needs no signature.
  if (body["verify"] === true || payload["verify"] === true) {
    return { status: 200, body: { success: true, data: { action, verified: true }, message: "verify ok" }, encrypted, bind: requestBind };
  }

  // 3.5. Request-signature verification (F3a). Real gateway traffic is ALWAYS signed, so a
  //      tampered routing header, a replayed nonce, a stale timestamp or a forged signature is
  //      rejected here (401). An ABSENT signature is allowed (unsigned tooling) unless
  //      BROKER_REQUIRE_SIG is set — the opt-in that forbids the strip-the-header downgrade.
  const sigHeader = hdr(input.headers, "x-omni-sig");
  if (sigHeader) {
    const bind = requestBind;
    const canonical: CanonicalRequest = {
      // Under PSK the routing fields come from the decrypted envelope; unsealed, from the
      // cleartext headers (which equal the envelope values the gateway signed).
      action: encrypted ? String(body["action"] ?? "") : (hdr(input.headers, "x-omniproject-action") ?? String(body["action"] ?? "")),
      source: encrypted ? String(body["source"] ?? "") : (hdr(input.headers, "x-omniproject-source") ?? ""),
      idempotencyKey: encrypted ? String(body["idempotencyKey"] ?? "") : (hdr(input.headers, "x-omniproject-idempotency-key") ?? ""),
      origin: encrypted ? String(body["origin"] ?? "") : (hdr(input.headers, "x-omniproject-origin") ?? ""),
      body: input.rawBody,
    };
    const verdict = verifyBrokerRequest({ ts: Number(hdr(input.headers, "x-omni-ts")), nonce: hdr(input.headers, "x-omni-nonce") ?? "", sig: sigHeader, req: canonical, bind });
    if (verdict !== "ok") return { status: 401, body: { success: false, message: `signature ${verdict}` }, encrypted };
  } else if (process.env["BROKER_REQUIRE_SIG"] === "true" || process.env["BROKER_REQUIRE_SIG"] === "1") {
    return { status: 401, body: { success: false, message: "missing request signature" }, encrypted };
  }

  // 4. Dispatch + map results/errors onto the envelope + taxonomy.
  try {
    const data = await dispatch(action, payload, ctx, be);
    return { status: 200, body: { success: true, data, message: null }, encrypted, bind: requestBind };
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
        headers: req.headers,
      }).then((r) => {
        const wire = JSON.stringify(r.body);
        const rs = signBrokerResponse(wire, r.bind); // sign the reply under the request's key
        res.writeHead(r.status, { "Content-Type": "application/json", "X-OmniProject-Origin": "omniproject", "X-Omni-Resp-Sig": rs.sig, "X-Omni-Resp-Ts": String(rs.ts) });
        res.end(wire);
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
