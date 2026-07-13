/**
 * Broker-isolation guard.
 *
 * Hard rule: a concrete broker is named in a small set of sanctioned homes — the reference broker's
 * adapter folder `artifacts/api-server/src/broker/reference-broker/` (code), every broker's
 * per-vendor template under `artifacts/api-server/src/broker/templates/` (code), and each broker's
 * `lib/backend-catalogue/vendors/brokers/<vendor>.json` (data). Everywhere else the product is
 * broker-NEUTRAL: above the seam, code talks to a broker only through the generic `Broker`
 * interface, and no user-facing copy, route or type names a concrete vendor.
 *
 * Deploy manifests are the one documented exception: a runnable deployment has to ship SOME broker,
 * and the product ships the **reference** broker (the `reference:true` entry in the catalogue —
 * currently n8n) as its bundled runtime, so its name legitimately appears in the compose / helm /
 * k8s / traefik templates. What must NOT appear there is any OTHER broker vendor — swapping brokers
 * is a customer choice, not something a shipped template should hard-code.
 *
 * The vendor tokens are DERIVED from the catalogue JSON (each broker's `id`, with a distinctive
 * brand alias for ids that are common English words — Make→Integromat — and generic-only ids such
 * as `serverless` left to import-reach + template-home isolation), so adding a broker under
 * vendors/brokers/ extends the name-scan automatically, no edit here.
 *
 * Three checks, all fail CI:
 *   1. IMPORT REACH — nothing may import a concrete adapter except the seam factory
 *      (`broker/index.ts`) and the adapter's own folder.
 *   2. NAMING (code) — no vendor token may appear in CODE (comments excluded — they legitimately
 *      document the reference broker) anywhere in the gateway, the SPA, or the backend-catalogue
 *      package, except the allowlisted homes and generated (`*.generated.ts`) vendor data.
 *   3. NAMING (deploy) — no NON-reference vendor token may appear in the deploy trees (deploy/,
 *      docker-compose*.yml, k8s-enterprise-manifest.yaml, traefik/); the reference broker is allowed
 *      there as the bundled runtime.
 *
 * Run: `pnpm --filter @workspace/scripts run guard-broker-isolation`
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

/** Concrete adapter folders (relative to GATEWAY_SRC) that may only be imported via the seam. */
const ADAPTER_DIRS = ["broker/reference-broker"];
/** Files allowed to import a concrete adapter (relative to GATEWAY_SRC): the seam factory. */
const SEAM_FACTORY = ["broker/index.ts"];

/** The broker catalogue (one `<vendor>.json` per broker). Vendor tokens are derived from here. */
const BROKERS_DIR = "lib/backend-catalogue/vendors/brokers";

/** Broker ids that are common English words / generic architecture terms a static name-scan can't
 *  tell apart from prose. For these we scan the distinctive brand alias instead of the bare id
 *  (Make's `id` is "make", scanned as its brand "Integromat"); an id with no distinctive brand
 *  (`serverless` is a generic term, not a brand) maps to null and is left OUT of the name-scan — it
 *  is still isolated by import-reach and its `broker/templates/` home, just not by name. */
const GENERIC_ID_ALIASES: Record<string, string | null> = { make: "integromat", serverless: null };

/** A broker id/alias → a regex fragment matching its hyphen / underscore / space spellings
 *  (`node-red` → `node[-_\s]?red`), with regex metacharacters in each segment escaped. */
function tokenFragment(s: string): string {
  return s.split(/[-_\s]+/).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[-_\\s]?");
}

/** Derive, from the catalogue JSON, the name-scan fragment for every concrete broker plus the
 *  reference broker's own fragment (the one allowed in deploy manifests as the bundled runtime). */
function deriveVendorTokens(): { fragments: string[]; referenceFragment: string } {
  const dir = path.join(ROOT, BROKERS_DIR);
  const fragments: string[] = [];
  let referenceFragment = "n8n"; // safe fallback; the JSON `reference:true` broker overrides it below
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
    const j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as { id: string; reference?: boolean };
    const alias = Object.prototype.hasOwnProperty.call(GENERIC_ID_ALIASES, j.id) ? GENERIC_ID_ALIASES[j.id]! : j.id;
    if (alias) fragments.push(tokenFragment(alias));
    if (j.reference) referenceFragment = tokenFragment(alias ?? j.id);
  }
  return { fragments, referenceFragment };
}

const { fragments: VENDOR_FRAGMENTS, referenceFragment: REFERENCE_FRAGMENT } = deriveVendorTokens();
/** Any concrete broker's name, for the CODE naming scan. */
const VENDOR_TOKEN = new RegExp(`(${VENDOR_FRAGMENTS.join("|")})`, "i");
/** Any NON-reference broker's name, for the DEPLOY naming scan (the reference broker is the bundled
 *  runtime and legitimately appears in the manifests). */
const NON_REFERENCE_FRAGMENTS = VENDOR_FRAGMENTS.filter((f) => f !== REFERENCE_FRAGMENT);
const DEPLOY_VENDOR_TOKEN = NON_REFERENCE_FRAGMENTS.length ? new RegExp(`(${NON_REFERENCE_FRAGMENTS.join("|")})`, "i") : null;

/** Source trees scanned for vendor NAMING in code (relative to ROOT). Backend-catalogue is
 *  included so a shared/neutral type (e.g. a binding interface) can't quietly re-acquire a
 *  vendor-specific name — `*.generated.ts` files are skipped everywhere below since they are
 *  vendor JSON data embedded verbatim, the same sanctioned exception as the JSON itself. */
const NAMING_DIRS = [GATEWAY_SRC, "artifacts/omniproject/src", CATALOGUE_SRC];
/** Deploy trees scanned for NON-reference vendor NAMING. Whole trees plus the root-level manifests
 *  the doc calls out (docker-compose*.yml is matched by glob below). */
const DEPLOY_ROOTS = ["deploy", "traefik"];
const DEPLOY_ROOT_FILES = ["k8s-enterprise-manifest.yaml"]; // + docker-compose*.yml, matched by glob
/** Paths (relative to ROOT) where a vendor token may appear as code: the reference adapter home, the
 *  per-vendor template home (every broker's generated flow/component/scenario lives here — the same
 *  "this file IS about that vendor" exception as the adapter folder), the seam factory that
 *  constructs the reference broker, the neutral resolver that owns the legacy env alias, the
 *  blueprint generator that IS the reference-broker build tool, and the neutral catalogue enums
 *  (`BrokerKind`, `ActionMapping["kind"]`) whose job is literally to enumerate vendor/transport
 *  identifiers — the same sanctioned shape as the JSON `id`/`kind` fields they mirror. */
const NAMING_ALLOW = [
  `${GATEWAY_SRC}/broker/reference-broker`,
  `${GATEWAY_SRC}/broker/templates`,
  `${GATEWAY_SRC}/broker/index.ts`,
  `${GATEWAY_SRC}/lib/broker-url.ts`,
  `${CATALOGUE_SRC}/workflow-generator.ts`,
  `${CATALOGUE_SRC}/broker-catalogue.ts`,
  `${CATALOGUE_SRC}/backend-catalogue.ts`,
  `${CATALOGUE_SRC}/index.ts`, // barrel re-export of the generator above, same reasoning
  `${CATALOGUE_SRC}/planes.ts`, // lists n8n only as one illustrative broker example, same pattern
  // every other plane uses to name example vendors (Jira/SAP/Salesforce for backends, etc.)
];

/** The adapter folder a line imports (dynamic or static), or null. Uses the shared
 *  `importSpecifier` so a dynamic `import("…reference-broker")` is caught, not just static forms. */
function importsAdapter(line: string): string | null {
  const spec = importSpecifier(line);
  if (!spec) return null;
  for (const dir of ADAPTER_DIRS) {
    const leaf = dir.split("/").pop()!;
    if (new RegExp(`(^|/)${leaf}(/|$)`).test(spec)) return dir;
  }
  return null;
}

function listTsFiles(relDir: string): string[] {
  return walkFiles(path.join(ROOT, relDir), {
    extensions: [".ts", ".tsx"],
    excludeSuffixes: [".test.ts", ".spec.ts", ".test.tsx", ".spec.tsx"],
  }).map((abs) => path.relative(ROOT, abs));
}

/** Every file (any extension) under an absolute dir — deploy trees are YAML/tpl/md/json, not just
 *  `.ts`, so the ts-only walker above won't reach them. */
function listAllFiles(absDir: string): string[] {
  if (!fs.existsSync(absDir)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(absDir, { withFileTypes: true })) {
    const full = path.join(absDir, e.name);
    if (e.isDirectory()) out.push(...listAllFiles(full));
    else out.push(full);
  }
  return out;
}

/** The deploy manifests to scan (relative to ROOT): the whole deploy/ + traefik/ trees, the named
 *  root manifests, and any root-level docker-compose*.yml. */
function listDeployFiles(): string[] {
  const abs = new Set<string>();
  for (const root of DEPLOY_ROOTS) for (const f of listAllFiles(path.join(ROOT, root))) abs.add(f);
  for (const f of DEPLOY_ROOT_FILES) { const p = path.join(ROOT, f); if (fs.existsSync(p)) abs.add(p); }
  for (const f of fs.readdirSync(ROOT)) if (/^docker-compose.*\.ya?ml$/.test(f)) abs.add(path.join(ROOT, f));
  return [...abs].map((a) => path.relative(ROOT, a)).sort();
}

const violations: string[] = [];

// 1. Import-reach: no adapter import outside the seam factory / the adapter folder.
const importAllowed = (rel: string): boolean =>
  SEAM_FACTORY.includes(rel) || ADAPTER_DIRS.some((d) => rel === d || rel.startsWith(d + "/"));
for (const rel of listTsFiles(GATEWAY_SRC).map((r) => r.slice(GATEWAY_SRC.length + 1))) {
  if (importAllowed(rel)) continue;
  fs.readFileSync(path.join(ROOT, GATEWAY_SRC, rel), "utf8").split("\n").forEach((line, i) => {
    const dir = importsAdapter(line);
    if (dir) violations.push(`${GATEWAY_SRC}/${rel}:${i + 1}  [import] reaches adapter '${dir}' — ${line.trim().slice(0, 80)}`);
  });
}

// 2. Naming: the vendor token may not appear in code outside its sanctioned homes.
// `.generated.ts` files are skipped everywhere — they are vendor JSON embedded verbatim by
// gen-vendors/gen-fields/etc. (the same sanctioned "data, not code" exception as the JSON itself).
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

// 3. Deploy naming: no NON-reference broker vendor may be named in the deploy trees. The reference
// broker is the bundled runtime and legitimately appears there, so it's excluded from this token.
if (DEPLOY_VENDOR_TOKEN) {
  for (const rel of listDeployFiles()) {
    let src: string;
    try { src = fs.readFileSync(path.join(ROOT, rel), "utf8"); } catch { continue; }
    if (!DEPLOY_VENDOR_TOKEN.test(src)) continue;
    src.split("\n").forEach((text, i) => {
      if (DEPLOY_VENDOR_TOKEN.test(text)) violations.push(`${rel}:${i + 1}  [deploy-naming] ${text.trim().slice(0, 90)}`);
    });
  }
}

reportGuard("broker-isolation", {
  violations,
  failHeadline: "Broker-isolation guard failed — a concrete broker leaks outside its home:",
  help:
    "A concrete broker may be named only in the reference adapter folder + per-vendor template home " +
    "(code), the seam factory that constructs the reference broker, the neutral broker-url resolver, " +
    "and vendors/brokers/<vendor>.json (data). Deploy manifests may name ONLY the bundled reference " +
    "broker. Everywhere else use the generic Broker interface and broker-neutral wording. Comments are exempt.",
  okSummary:
    `no adapter import or vendor naming outside the sanctioned homes ` +
    `(scanned ${VENDOR_FRAGMENTS.length} derived vendor tokens; deploy trees allow only the reference broker).`,
});
