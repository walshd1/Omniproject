import fs from "node:fs";
import { verifyPlaneEntry, PLANES } from "@workspace/backend-catalogue";

/**
 * Verify developer-written plane entries against the plane contract.
 *
 *   pnpm --filter @workspace/scripts verify-plane <plane> <entry.json>
 *
 * <plane> is one of: backends brokers outputs notifications methodologies reports
 * screens. <entry.json> is a single entry object or an array of them. Exits 0 when
 * all valid, 1 on any error, 2 on usage/IO problems. Use it in CI for a contributed
 * registry entry.
 */
const [, , plane, file] = process.argv;

if (!plane || !file) {
  console.error("usage: verify-plane <plane> <entry.json>");
  console.error(`planes: ${PLANES.map((p) => p.id).join(" ")}`);
  process.exit(2);
}

let parsed: unknown;
try {
  parsed = JSON.parse(fs.readFileSync(file, "utf8"));
} catch (e) {
  console.error(`cannot read/parse ${file}: ${e instanceof Error ? e.message : e}`);
  process.exit(2);
}

const entries = Array.isArray(parsed) ? parsed : [parsed];
let failures = 0;
for (const entry of entries) {
  const id = (entry as { id?: string })?.id ?? "(no id)";
  const r = verifyPlaneEntry(plane, entry);
  if (r.ok) {
    console.log(`✓ ${id} — valid ${plane} entry`);
  } else {
    failures++;
    console.error(`✗ ${id}:\n  ${r.errors.join("\n  ")}`);
  }
  for (const w of r.warnings) console.warn(`  ! ${w}`);
}

console.log(`\n${entries.length - failures}/${entries.length} valid.`);
process.exit(failures ? 1 : 0);
