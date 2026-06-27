/**
 * REFERENCE OUTPUT BLUEPRINT — a complete-but-stubbed outward interface (the
 * output plane's deliberately non-functional reference).
 *
 * Every output (OData, BI feed, MCP, an export, metrics) follows the SAME shape:
 *
 *   authenticate → read THROUGH the broker (never a backend directly)
 *               → shape a READ-ONLY projection → serialise
 *
 * This implements all of that correctly except the one part only you write — the
 * `shape` projection — which throws `NotImplemented` (→ 501). Wire `shape` to your
 * format and you have a new output that inherits the broker seam + RBAC + audit,
 * adds no at-rest scope, and stays stateless. Pure + injectable so it's testable
 * without the full app.
 */

export class NotImplemented extends Error {
  constructor(part: string) {
    super(`output.${part}() is not implemented — shape your projection`);
    this.name = "NotImplemented";
  }
}

export interface OutputDeps<T> {
  /** Did the request carry a valid session OR read-only API token? */
  authed: boolean;
  /** Read through the broker (injected — `() => getBroker().listProjects(ctx)`).
   *  Outputs are READ-ONLY: this must never mutate a backend. */
  read: () => Promise<unknown>;
  /** YOUR projection: map the broker data to this output's shape. Default throws
   *  so an unimplemented output is honest (501), never a silent empty body. */
  shape?: (data: unknown) => T;
  /** Optional audit hook (e.g. recordAudit) so the read shows in the trail. */
  audit?: () => void;
}

export interface OutputResult<T = unknown> {
  status: number;
  body: T | { error: string };
}

/** Serve one output request. Complete plumbing; `shape` is yours to implement. */
export async function serveOutput<T>(deps: OutputDeps<T>): Promise<OutputResult<T>> {
  if (!deps.authed) return { status: 401, body: { error: "Unauthorized" } };
  const shape = deps.shape ?? (() => { throw new NotImplemented("shape"); });
  try {
    deps.audit?.();
    const data = await deps.read(); // read-only, through the broker
    return { status: 200, body: shape(data) };
  } catch (e) {
    if (e instanceof NotImplemented) return { status: 501, body: { error: e.message } };
    // Never leak internals — a backend read failure is a generic 502.
    return { status: 502, body: { error: "backend read failed" } };
  }
}
