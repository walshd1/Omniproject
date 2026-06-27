import { PLANES, type PlaneId } from "./planes";

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
    if (!isStr(e["via"])) errors.push("via: required string");
    if (!isArr(e["requiredEnv"])) errors.push("requiredEnv: required array");
    if (!isObj(e["capabilities"])) errors.push("capabilities: required object");
    // An "import" source (Excel/CSV) is fed through the column mapper + /api/import,
    // NOT brokered live — so it carries no auth header and no contract read actions.
    // "live" / "database" backends are brokered and must declare both.
    if (e["kind"] === "import") return;
    if (!isStr(e["authHeader"]) && !isStr(e["credentialType"])) errors.push("authHeader OR credentialType: one is required");
    const a = e["actions"] as Rec | undefined;
    if (!isObj(a)) errors.push("actions: required object");
    else { if (!a?.["list_projects"]) errors.push("actions.list_projects: required (core read)"); if (!a?.["list_issues"]) errors.push("actions.list_issues: required (core read)"); }
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
    const roles = ["viewer", "contributor", "manager", "pmo", "admin"];
    if (!isObj(c) || !roles.includes(c?.["requiresRole"] as string)) errors.push("capabilities.requiresRole: viewer|contributor|manager|admin");
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
