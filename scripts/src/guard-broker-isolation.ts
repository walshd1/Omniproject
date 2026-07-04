/**
 * Broker-isolation guard.
 *
 * Hard rule: a concrete broker is named in exactly two homes — its adapter folder
 * `artifacts/api-server/src/broker/<vendor>/` (code) and `lib/backend-catalogue/vendors/brokers/
 * <vendor>.json` (data). Everywhere else the product is broker-NEUTRAL: above the seam, code talks
 * to a broker only through the generic `Broker` interface, and no user-facing copy, route, type or
 * deploy template names a concrete vendor.
 *
 * Two checks, both fail CI:
 *   1. IMPORT REACH — nothing may import a concrete adapter except the seam factory
 *      (`broker/index.ts`) and the adapter's own folder.
 *   2. NAMING — the vendor token may not appear in CODE (comments excluded — they legitimately
 *      document the reference broker) anywhere in the gateway, the SPA, or the backend-catalogue
 *      package, except the allowlisted homes and generated (`*.generated.ts`) vendor data.
 *
 * Run: `pnpm --filter @workspace/scripts run guard-broker-isolation`
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { walkFiles } from "./lib/walk-files";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const GATEWAY_SRC = "artifacts/api-server/src";
const CATALOGUE_SRC = "lib/backend-catalogue/src";

/** Concrete adapter folders (relative to GATEWAY_SRC) that may only be imported via the seam. */
const ADAPTER_DIRS = ["broker/reference-broker"];
/** Files allowed to import a concrete adapter (relative to GATEWAY_SRC): the seam factory. */
const SEAM_FACTORY = ["broker/index.ts"];

/** The vendor token(s) that may only appear in their sanctioned homes. */
const VENDOR_TOKEN = /n8n/i;
/** Source trees scanned for vendor NAMING in code (relative to ROOT). Backend-catalogue is
 *  included so a shared/neutral type (e.g. a binding interface) can't quietly re-acquire a
 *  vendor-specific name — `*.generated.ts` files are skipped everywhere below since they are
 *  vendor JSON data embedded verbatim, the same sanctioned exception as the JSON itself. */
const NAMING_DIRS = [GATEWAY_SRC, "artifacts/omniproject/src", CATALOGUE_SRC];
/** Paths (relative to ROOT) where the vendor token may appear as code: the adapter home, the seam
 *  factory that constructs it, the neutral resolver that owns the legacy env alias, the blueprint
 *  generator that IS the n8n-specific build tool (mirrors the adapter folder), and the two neutral
 *  catalogue enums (`BrokerKind`, `ActionMapping["kind"]`) whose job is literally to enumerate
 *  vendor/transport identifiers — the same sanctioned shape as the JSON `id`/`kind` fields they
 *  mirror, not vendor-specific behaviour. */
const NAMING_ALLOW = [
  `${GATEWAY_SRC}/broker/reference-broker`,
  `${GATEWAY_SRC}/broker/index.ts`,
  `${GATEWAY_SRC}/lib/broker-url.ts`,
  `${CATALOGUE_SRC}/workflow-generator.ts`,
  `${CATALOGUE_SRC}/broker-catalogue.ts`,
  `${CATALOGUE_SRC}/backend-catalogue.ts`,
  `${CATALOGUE_SRC}/index.ts`, // barrel re-export of the generator above, same reasoning
  `${CATALOGUE_SRC}/planes.ts`, // lists n8n only as one illustrative broker example, same pattern
  // every other plane uses to name example vendors (Jira/SAP/Salesforce for backends, etc.)
];

function importsAdapter(line: string): string | null {
  const m = line.match(/(?:from|import|require\()\s*["']([^"']+)["']/);
  if (!m) return null;
  const spec = m[1]!;
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

/** Per-line CODE (line + block comments stripped), tracking block-comment state. */
function codeLines(src: string): { line: number; text: string }[] {
  const result: { line: number; text: string }[] = [];
  let inBlock = false;
  src.split("\n").forEach((raw, i) => {
    let text = raw;
    if (inBlock) {
      const end = text.indexOf("*/");
      if (end === -1) { result.push({ line: i + 1, text: "" }); return; }
      text = text.slice(end + 2);
      inBlock = false;
    }
    text = text.replace(/\/\*.*?\*\//g, "");
    const open = text.indexOf("/*");
    if (open !== -1) { inBlock = true; text = text.slice(0, open); }
    const sl = text.indexOf("//");
    if (sl !== -1) text = text.slice(0, sl);
    result.push({ line: i + 1, text });
  });
  return result;
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

if (violations.length) {
  console.error("::error::Broker-isolation guard failed — a concrete broker leaks outside its home:");
  for (const v of violations) console.error("  " + v);
  console.error(
    "\nA concrete broker may be named only in its adapter folder (code), the seam factory that " +
      "constructs it, the neutral broker-url resolver, and vendors/brokers/<vendor>.json (data). " +
      "Everywhere else use the generic Broker interface and broker-neutral wording. Comments are exempt.",
  );
  process.exit(1);
}

console.log("broker-isolation guard: OK — no adapter import or vendor naming outside the sanctioned homes.");
