/**
 * Backend-isolation guard — the BACKEND axis counterpart to guard-broker-isolation.
 *
 * A backend (the system of record — Jira / SAP / Salesforce / Invoice Ninja …) is reached backend-vendor-
 * NEUTRALLY: the gateway forwards contract verbs through the broker seam (`brokerCommand`) with the vendor
 * resolved from the connected `backendSource`, and vendor field mapping lives in the generated broker
 * workflow — so no backend vendor is named in code. The ONE exception is a backend that needs gateway-side
 * sync glue (outbound push / pull-back / inbound settlement webhook, which reconcile an external settlement
 * onto a LOCAL sealed invoice artifact). That vendor-shaped glue is confined to a single sanctioned home —
 * the backend-adapter folder `artifacts/api-server/src/broker/backends/` (code) plus each backend's
 * `lib/backend-catalogue/vendors/backends/<vendor>.json` (data). Everywhere else the product is backend-
 * neutral: above the seam, code resolves a backend only through the generic `BillingAdapter` interface /
 * `resolveBillingAdapter()`, and no route, type or user-facing copy names a concrete backend.
 *
 * The naming contract is PRECISE, and only applies where it can leak: a backend earns a name-scan token
 * exactly when it has a gateway-side ADAPTER FILE (`broker/backends/<id>.ts`) — i.e. it needs sync glue in
 * the gateway. A backend reached purely through the broker + generated workflow (Jira, GitHub, OpenProject,
 * SAP, …) has NO gateway code to leak, and its name legitimately appears in demo fixtures, OAuth IdP presets,
 * self-host export notes and connector copy — so it is NOT name-scanned. The token set therefore tracks the
 * adapter folder automatically: add `broker/backends/<vendor>.ts` and that vendor's neutrality is enforced;
 * add a plain catalogue backend and nothing changes here.
 *
 * Two checks, both fail CI:
 *   1. IMPORT REACH — nothing may import a CONCRETE backend adapter (`broker/backends/<vendor>`) except the
 *      seam factory (`broker/backends/index.ts`) and the adapter folder itself. Importing the neutral seam
 *      (`broker/backends`) is always fine. This applies to EVERY adapter file, present or future.
 *   2. NAMING (code) — an ADAPTER-BACKED backend's vendor token may not appear in CODE (comments excluded)
 *      anywhere in the gateway, the SPA, or the backend-catalogue package, except the adapter home itself
 *      and generated (`*.generated.ts`) vendor data.
 *
 * Run: `pnpm --filter @workspace/scripts run guard-backend-isolation`
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { walkFiles } from "./lib/walk-files";
import { importSpecifier, codeLines } from "./lib/ts-source";
import { reportGuard } from "./lib/guard-harness";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const GATEWAY_SRC = "artifacts/api-server/src";
const CATALOGUE_SRC = "lib/backend-catalogue/src";

/** The sanctioned backend-adapter home (relative to GATEWAY_SRC): concrete `<vendor>.ts` adapters + the
 *  neutral seam factory `index.ts`. */
const ADAPTER_DIR = "broker/backends";
/** File allowed to import a concrete adapter (relative to GATEWAY_SRC): the seam factory. */
const SEAM_FACTORY = [`${ADAPTER_DIR}/index.ts`];

/** A backend id → a regex fragment matching its hyphen / underscore / space spellings (`azure-devops` →
 *  `azure[-_\s]?devops`), with regex metacharacters in each segment escaped. */
function tokenFragment(s: string): string {
  return s.split(/[-_\s]+/).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[-_\\s]?");
}

/** The backend ids that have a gateway-side ADAPTER FILE — the only backends whose name must not leak. Derived
 *  from the adapter home: every `<id>.ts` under broker/backends/ except the seam factory (`index`) and tests. */
function adapterBackedIds(): string[] {
  const dir = path.join(ROOT, GATEWAY_SRC, ADAPTER_DIR);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "index.ts")
    .map((f) => f.replace(/\.ts$/, ""))
    .sort();
}

/** Name-scan fragments for exactly the adapter-backed backends. */
const VENDOR_FRAGMENTS = adapterBackedIds().map(tokenFragment);
/** Any concrete backend's name, for the CODE naming scan. */
const VENDOR_TOKEN = new RegExp(`(${VENDOR_FRAGMENTS.join("|")})`, "i");

/** Source trees scanned for vendor NAMING in code (relative to ROOT). */
const NAMING_DIRS = [GATEWAY_SRC, "artifacts/omniproject/src", CATALOGUE_SRC];
/** Paths (relative to ROOT) where a backend token may appear as code: the backend-adapter home (the sanctioned
 *  "this file IS about that vendor" exception, same shape as the broker reference-adapter folder), and the
 *  neutral catalogue files whose job is literally to enumerate vendor ids / document example vendors — the
 *  same sanctioned pattern guard-broker-isolation allows for the broker axis. */
const NAMING_ALLOW = [
  `${GATEWAY_SRC}/${ADAPTER_DIR}`,
  `${CATALOGUE_SRC}/backend-catalogue.ts`,
  `${CATALOGUE_SRC}/backend-manifest.ts`,
  `${CATALOGUE_SRC}/planes.ts`,
  `${CATALOGUE_SRC}/index.ts`,
];

/** Does a line import a concrete backend adapter (`broker/backends/<vendor>`, i.e. a file under the adapter
 *  home OTHER than the seam factory `index`)? Returns the imported specifier, or null. Importing the neutral
 *  seam (`broker/backends` or `broker/backends/index`) is not a concrete-adapter import. */
function importsConcreteAdapter(line: string): string | null {
  const spec = importSpecifier(line);
  if (!spec) return null;
  const m = new RegExp(`(^|/)${ADAPTER_DIR}/([^/'"\\s]+)`).exec(spec);
  if (!m) return null;
  const leaf = m[2]!;
  if (leaf === "index") return null; // the neutral seam factory
  return spec;
}

function listTsFiles(relDir: string): string[] {
  return walkFiles(path.join(ROOT, relDir), {
    extensions: [".ts", ".tsx"],
    excludeSuffixes: [".test.ts", ".spec.ts", ".test.tsx", ".spec.tsx"],
  }).map((abs) => path.relative(ROOT, abs));
}

const violations: string[] = [];

// 1. Import-reach: no concrete-adapter import outside the seam factory / the adapter folder.
const importAllowed = (rel: string): boolean =>
  SEAM_FACTORY.includes(rel) || rel === ADAPTER_DIR || rel.startsWith(ADAPTER_DIR + "/");
for (const rel of listTsFiles(GATEWAY_SRC).map((r) => r.slice(GATEWAY_SRC.length + 1))) {
  if (importAllowed(rel)) continue;
  fs.readFileSync(path.join(ROOT, GATEWAY_SRC, rel), "utf8").split("\n").forEach((line, i) => {
    const spec = importsConcreteAdapter(line);
    if (spec) violations.push(`${GATEWAY_SRC}/${rel}:${i + 1}  [import] reaches concrete backend adapter '${spec}' — use resolveBillingAdapter() from '../broker/backends'`);
  });
}

// 2. Naming: the vendor token may not appear in code outside its sanctioned homes. `.generated.ts` files are
// skipped everywhere — they are vendor JSON embedded verbatim (the same "data, not code" exception as the JSON).
const namingAllowed = (rel: string): boolean =>
  rel.endsWith(".generated.ts") || NAMING_ALLOW.some((a) => rel === a || rel.startsWith(a + "/"));
for (const dir of NAMING_DIRS) {
  for (const rel of listTsFiles(dir)) {
    if (namingAllowed(rel)) continue;
    const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
    if (!VENDOR_TOKEN.test(src)) continue;
    for (const { line, text } of codeLines(src)) {
      if (VENDOR_TOKEN.test(text)) violations.push(`${rel}:${line}  [naming] ${text.trim().slice(0, 90)}`);
    }
  }
}

reportGuard("backend-isolation", {
  violations,
  failHeadline: "Backend-isolation guard failed — a concrete backend leaks outside its home:",
  help:
    "A backend vendor may be named only in the backend-adapter home (broker/backends/, code) and " +
    "vendors/backends/<vendor>.json (data). Everywhere else use the generic BillingAdapter interface / " +
    "resolveBillingAdapter() and backend-neutral wording. Comments are exempt.",
  okSummary:
    `no concrete-adapter import or backend naming outside the sanctioned homes ` +
    `(scanned ${VENDOR_FRAGMENTS.length} derived backend tokens).`,
});
