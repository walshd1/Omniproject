/**
 * Broker-isolation guard.
 *
 * Hard rule: a concrete broker's CODE lives in exactly one home — its adapter folder
 * `artifacts/api-server/src/broker/<vendor>/` — and its DATA in
 * `lib/backend-catalogue/vendors/brokers/<vendor>.json`. Above the broker seam, code talks to a
 * broker only through the generic `Broker` interface, never a concrete adapter.
 *
 * This guard enforces the architecturally load-bearing half of that rule with zero false
 * positives: NOTHING may IMPORT a concrete broker adapter except the broker factory that wires
 * the seam (`broker/index.ts`) and the adapter's own folder. So a route, a lib helper, or the SPA
 * can never reach `broker/<vendor>` directly — swap the adapter and nothing above the seam moves.
 *
 * (Vendor NAMING in user-facing copy, route labels and deploy templates is a separate
 * "broker-agnostic language" concern, tracked independently — this guard is about code reach.)
 *
 * Run: `pnpm --filter @workspace/scripts run guard-broker-isolation`
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const GATEWAY_SRC = "artifacts/api-server/src";

/** Concrete adapter folders (relative to GATEWAY_SRC) that may only be imported via the seam. */
const ADAPTER_DIRS = ["broker/n8n"];

/** Files allowed to import a concrete adapter (relative to GATEWAY_SRC): the seam factory. The
 *  adapter's own folder is always allowed (intra-adapter imports). */
const SEAM_FACTORY = ["broker/index.ts"];

/** If `line` imports a concrete adapter folder, return that folder; else null. Matches a
 *  specifier whose last path segment is the adapter leaf (e.g. `./n8n`, `../broker/n8n`,
 *  `../broker/n8n/index`, `../../broker/n8n/expr`). */
function importsAdapter(line: string): string | null {
  const m = line.match(/(?:from|import|require\()\s*["']([^"']+)["']/);
  if (!m) return null;
  const spec = m[1]!;
  for (const dir of ADAPTER_DIRS) {
    const leaf = dir.split("/").pop()!; // e.g. "n8n"
    // The adapter leaf appears as a path segment that is either the final segment, or followed
    // by a deeper path into the adapter folder (…/n8n or …/n8n/expr).
    if (new RegExp(`(^|/)${leaf}(/|$)`).test(spec)) return dir;
  }
  return null;
}

function listTsFiles(absDir: string, relBase: string): string[] {
  if (!fs.existsSync(absDir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    const abs = path.join(absDir, entry.name);
    const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listTsFiles(abs, rel));
    else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name)) out.push(rel);
  }
  return out;
}

const allowed = (rel: string): boolean =>
  SEAM_FACTORY.includes(rel) || ADAPTER_DIRS.some((d) => rel === d || rel.startsWith(d + "/"));

const violations: string[] = [];
for (const rel of listTsFiles(path.join(ROOT, GATEWAY_SRC), "")) {
  if (allowed(rel)) continue;
  const src = fs.readFileSync(path.join(ROOT, GATEWAY_SRC, rel), "utf8");
  src.split("\n").forEach((line, i) => {
    const dir = importsAdapter(line);
    if (dir) violations.push(`${GATEWAY_SRC}/${rel}:${i + 1}  imports adapter '${dir}' — ${line.trim().slice(0, 90)}`);
  });
}

if (violations.length) {
  console.error("::error::Broker-isolation guard failed — a concrete adapter is imported outside the seam:");
  for (const v of violations) console.error("  " + v);
  console.error(
    "\nOnly the broker factory (" + SEAM_FACTORY.join(", ") + ") may import a concrete adapter. " +
      "Everywhere else, depend on the generic `Broker` interface via getBroker().",
  );
  process.exit(1);
}

console.log(`broker-isolation guard: OK — adapters [${ADAPTER_DIRS.join(", ")}] are imported only via the seam.`);
