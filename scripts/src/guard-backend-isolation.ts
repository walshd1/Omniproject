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
 * exactly when it ADVERTISES invoice sync (carries an `invoiceSync` block in its manifest) — the only backends
 * with any gateway-side sync surface. That surface is now fully DATA-DRIVEN: the advertised spec is applied by
 * the generic projector (`broker/backends/invoice-mapping`), so even the billing backend's name must not appear
 * in gateway code. A backend reached purely through the broker + generated workflow (Jira, GitHub, OpenProject,
 * SAP, …) has NO gateway code to leak, and its name legitimately appears in demo fixtures, OAuth IdP presets,
 * self-host export notes and connector copy — so it is NOT name-scanned. The token set tracks the data: add an
 * `invoiceSync` block and that vendor's neutrality is enforced; add a plain catalogue backend and nothing changes.
 *
 * Two checks, both fail CI:
 *   1. IMPORT REACH — nothing may import a concrete file under `broker/backends/` (other than the neutral seam
 *      `index`) from outside that folder: the routes must go through the seam. Importing the seam
 *      (`broker/backends`) is always fine.
 *   2. NAMING (code) — an advertised billing backend's vendor token may not appear in CODE (comments excluded)
 *      anywhere in the gateway, the SPA, or the backend-catalogue package, except generated (`*.generated.ts`)
 *      vendor data and the neutral catalogue enumerators.
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

/** The backend catalogue dir (one `<id>.json` per backend). */
const BACKENDS_DIR = "lib/backend-catalogue/vendors/backends";

/** The backend ids that ADVERTISE invoice sync (carry an `invoiceSync` block) — the only backends with any
 *  gateway-side sync surface, hence the only ones whose name must not appear in code. A backend reached purely
 *  through the broker + generated workflow has no gateway code to leak and is not name-scanned. Deriving from
 *  the manifest means the token set tracks the data: add an `invoiceSync` block and that vendor's neutrality is
 *  enforced automatically. */
function billingBackendIds(): string[] {
  const dir = path.join(ROOT, BACKENDS_DIR);
  if (!fs.existsSync(dir)) return [];
  const ids: string[] = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    const j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as { id: string; invoiceSync?: unknown };
    if (j.invoiceSync) ids.push(j.id);
  }
  return ids.sort();
}

/** Name-scan fragments for exactly the advertised billing backends. */
const VENDOR_FRAGMENTS = billingBackendIds().map(tokenFragment);
/** Any concrete backend's name, for the CODE naming scan. */
const VENDOR_TOKEN = new RegExp(`(${VENDOR_FRAGMENTS.join("|")})`, "i");

/** Source trees scanned for vendor NAMING in code (relative to ROOT). */
const NAMING_DIRS = [GATEWAY_SRC, "artifacts/omniproject/src", CATALOGUE_SRC];
/** Paths (relative to ROOT) where a backend token may legitimately appear as code: the neutral catalogue files
 *  whose job is literally to enumerate vendor ids / document example vendors — the same sanctioned pattern
 *  guard-broker-isolation allows for the broker axis. NOTE the backend-adapter home (broker/backends/) is NOT
 *  allowlisted: with sync fully data-driven it holds only the neutral seam + projector, so it is held to the
 *  same zero-vendor-name bar as everything else. */
const NAMING_ALLOW = [
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

// 3. Vendor branching: no code in the broker integration layer (above the seam) may compare or `case` on a
// backend-id literal — special-casing a vendor is a leak even when the id string is otherwise benign; behaviour
// must be resolved from the manifest, not branched in code. Scanned for all DISTINCTIVE backend ids (common-word
// ids like plane/sql/excel are excluded to avoid false hits) across broker/ only: OAuth/IdP provider code lives
// elsewhere and legitimately compares against provider ids that happen to coincide with a backend id.
const GENERIC_BRANCH_IDS = new Set(["plane", "linear", "sql", "excel", "enterprise", "sap", "monday"]);
function distinctiveBackendIds(): string[] {
  const dir = path.join(ROOT, BACKENDS_DIR);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((x) => x.endsWith(".json"))
    .map((f) => (JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as { id: string }).id)
    .filter((id) => !GENERIC_BRANCH_IDS.has(id));
}
const BRANCH_IDS = distinctiveBackendIds();
const idAlt = BRANCH_IDS.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
const BRANCH_RE = BRANCH_IDS.length
  ? new RegExp(`(?:[=!]==?\\s*|\\bcase\\s+)["'](?:${idAlt})["']|["'](?:${idAlt})["']\\s*[=!]==?`)
  : null;
if (BRANCH_RE) {
  for (const rel of listTsFiles(`${GATEWAY_SRC}/broker`)) {
    if (rel.endsWith(".generated.ts")) continue;
    for (const { line, text } of codeLines(fs.readFileSync(path.join(ROOT, rel), "utf8"))) {
      if (BRANCH_RE.test(text)) violations.push(`${rel}:${line}  [branch] special-cases a backend id — resolve behaviour from the manifest, don't branch: ${text.trim().slice(0, 80)}`);
    }
  }
}

reportGuard("backend-isolation", {
  violations,
  failHeadline: "Backend-isolation guard failed — a concrete backend leaks outside its home:",
  help:
    "A backend vendor may be named only in vendors/backends/<vendor>.json (data); above the seam use the " +
    "generic BillingAdapter / resolveBillingAdapter() and never branch on a backend id — resolve behaviour " +
    "from the manifest. Advertised mappings (invoiceSync/statusVocabulary/…) are data, not code. Comments are exempt.",
  okSummary:
    `no concrete-adapter import, backend naming, or backend-id branching above the seam ` +
    `(scanned ${VENDOR_FRAGMENTS.length} name token(s) + ${BRANCH_IDS.length} branch ids).`,
});
