import { PLANES, type PlaneId } from "./planes";
import { VERIFICATION_STATUSES, BACKEND_RECORD_TYPES, RECORD_TYPE_REQUIRED_READS, type BackendRecordType } from "./backend-manifest";

/**
 * Plane verifier — validates a developer-written entry for ANY plane against that
 * plane's manifest contract (shape + capabilities/tools linkage + plane-specific
 * invariants). The static check a contributor runs BEFORE adding an entry to a
 * registry (broker RUNTIME conformance is separate — see broker/conformance.ts).
 *
 * Every shipped entry passes its own verifier (see plane-verifier.test.ts), so the
 * verifier and the registries can never drift.
 */

export interface PlaneVerifyResult {
  ok: boolean;
  plane: string;
  errors: string[];
  warnings: string[];
}

type Rec = Record<string, unknown>;
const isStr = (v: unknown): boolean => typeof v === "string" && v.length > 0;
const isArr = (v: unknown): boolean => Array.isArray(v);
const isObj = (v: unknown): boolean => !!v && typeof v === "object" && !Array.isArray(v);

function base(e: Rec, errors: string[]): void {
  if (!isStr(e["id"])) errors.push("id: required non-empty string");
  if (!isStr(e["label"])) errors.push("label: required non-empty string");
}

const CHECKS: Record<PlaneId, (e: Rec, errors: string[]) => void> = {
  backends: (e, errors) => {
    if (!(VERIFICATION_STATUSES as readonly string[]).includes(e["verification"] as string)) {
      errors.push(`verification: required, one of ${VERIFICATION_STATUSES.join("|")}`);
    }
    if (!isStr(e["via"])) errors.push("via: required string");
    if (!isArr(e["requiredEnv"])) errors.push("requiredEnv: required array");
    if (!isObj(e["capabilities"])) errors.push("capabilities: required object");
    // Every backend must declare its PRIMARY RECORD TYPE (issue | invoice | …) — a backend need not be a
    // project tool, but it must own a record, since that decides which contract reads it must implement.
    const record = e["primaryRecord"];
    const validRecord = (BACKEND_RECORD_TYPES as readonly string[]).includes(record as string);
    if (!validRecord) errors.push(`primaryRecord: required, one of ${BACKEND_RECORD_TYPES.join("|")}`);
    // An "import" source (Excel/CSV) is fed through the column mapper + /api/import,
    // NOT brokered live — so it carries no auth header and no contract read actions.
    // "live" / "database" backends are brokered and must declare both.
    if (e["kind"] === "import") return;
    if (!isStr(e["authHeader"]) && !isStr(e["credentialType"])) errors.push("authHeader OR credentialType: one is required");
    const a = e["actions"] as Rec | undefined;
    if (!isObj(a)) errors.push("actions: required object");
    else if (validRecord) {
      // Require the read verbs for the DECLARED record type: an `issue` backend must expose projects+issues;
      // an `invoice` backend must expose its invoice list. The model no longer assumes every backend is a
      // project tool — it enforces the reads appropriate to whatever record the backend owns.
      const acts = a as Rec;
      for (const read of RECORD_TYPE_REQUIRED_READS[record as BackendRecordType]) {
        if (!acts[read]) errors.push(`actions.${read}: required (core read for a ${String(record)} backend)`);
      }
    }
  },
  brokers: (e, errors) => {
    if (!isStr(e["kind"])) errors.push("kind: required");
    const c = e["capabilities"] as Rec | undefined;
    if (!isObj(c) || typeof c?.["synchronous"] !== "boolean") errors.push("capabilities.synchronous: boolean required");
    if (!isArr(e["transports"])) errors.push("transports: required array");
    if (!isStr(e["build"])) errors.push("build: required");
  },
  outputs: (e, errors) => {
    if (!isStr(e["route"])) errors.push("route: required");
    if (!isStr(e["kind"])) errors.push("kind: required");
    const c = e["capabilities"] as Rec | undefined;
    if (!isObj(c) || typeof c?.["readOnly"] !== "boolean") errors.push("capabilities.readOnly: boolean required");
    if (!isArr(e["tools"])) errors.push("tools: required array");
  },
  notifications: (e, errors) => {
    if (!isStr(e["kind"])) errors.push("kind: required");
    const c = e["capabilities"] as Rec | undefined;
    if (!isObj(c) || !isStr(c?.["delivery"])) errors.push("capabilities.delivery: required");
    if (!isArr(e["tools"])) errors.push("tools: required array");
  },
  methodologies: (e, errors) => {
    if (!isStr(e["kind"])) errors.push("kind: required");
    if (!isObj(e["capabilities"])) errors.push("capabilities: required object");
    const t = e["tools"] as Rec | undefined;
    if (!isObj(t) || !isArr(t?.["states"]) || !isArr(t?.["ceremonies"])) errors.push("tools.{states,ceremonies}: arrays required");
  },
  reports: (e, errors) => {
    if (!isStr(e["kind"])) errors.push("kind: required");
    const c = e["capabilities"] as Rec | undefined;
    if (!isObj(c) || !("requiresCapability" in (c ?? {}))) errors.push("capabilities.requiresCapability: required (string | null — links to a backend domain)");
    if (!isArr(e["tools"])) errors.push("tools: required array");
  },
  screens: (e, errors) => {
    if (!isStr(e["route"])) errors.push("route: required");
    if (!isStr(e["kind"])) errors.push("kind: required");
    const c = e["capabilities"] as Rec | undefined;
    // Must match ScreenCapability.requiresRole exactly (screen-catalogue.ts): the linear ladder
    // only — `pmo`/`admin` are orthogonal authorities and `pmo` is NOT a valid screen-gate role,
    // so it must not be accepted here (the validator had drifted more permissive than the type).
    const roles = ["viewer", "contributor", "manager", "admin"];
    if (!isObj(c) || !roles.includes(c?.["requiresRole"] as string)) errors.push(`capabilities.requiresRole: ${roles.join("|")}`);
    if (!isArr(e["tools"])) errors.push("tools: required array");
  },
};

/** Verify one entry for a plane. Returns ok + any errors/warnings. */
export function verifyPlaneEntry(planeId: string, entry: unknown): PlaneVerifyResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!PLANES.some((p) => p.id === planeId)) return { ok: false, plane: planeId, errors: [`unknown plane: ${planeId}`], warnings };
  if (!isObj(entry)) return { ok: false, plane: planeId, errors: ["entry must be an object"], warnings };
  const e = entry as Rec;
  base(e, errors);
  CHECKS[planeId as PlaneId](e, errors);
  // Cross-plane references (optional) must point at real planes.
  const ap = e["alsoProvides"];
  if (ap !== undefined) {
    if (!isArr(ap)) errors.push("alsoProvides: must be an array of { plane }");
    else for (const x of ap as Rec[]) if (!PLANES.some((p) => p.id === x?.["plane"])) warnings.push(`alsoProvides references an unknown plane: ${String(x?.["plane"])}`);
  }
  return { ok: errors.length === 0, plane: planeId, errors, warnings };
}
