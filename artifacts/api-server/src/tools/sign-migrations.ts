/**
 * Migration-manifest signing CLI (docs/UPDATE-MECHANISM.md §8, phase 6) — approves which migrations may run.
 *
 * Signs the list of migration ids that a release is allowed to apply, with the release/promotion PRIVATE key.
 * The runtime runs a pending migration ONLY if it appears in this verified manifest (fail-closed) — so code
 * shipping in the image can never quietly reshape data on its own authority.
 *
 * Usage:
 *   RELEASE_PRIVATE_KEY="$(cat release.key)" \
 *   tsx src/tools/sign-migrations.ts --ids 2026-07-add-field,2026-07-drop-legacy [--out migrations.json]
 */
import fs from "node:fs";
import { buildSignedMigrationManifest } from "../lib/release-migration";

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < process.argv.length) return process.argv[i + 1];
  return process.env[`RELEASE_${name.toUpperCase()}`];
}
function fail(msg: string): never { process.stderr.write(`sign-migrations: ${msg}\n`); process.exit(2); }

const idsRaw = flag("ids");
if (!idsRaw) fail("missing --ids (or RELEASE_IDS) — a comma-separated list of migration ids to approve");
const ids = idsRaw!.split(",").map((s) => s.trim()).filter(Boolean);
if (ids.length === 0) fail("--ids resolved to an empty list");

const privateKey = process.env["RELEASE_PRIVATE_KEY"] ?? "";
if (!privateKey.trim()) fail("missing RELEASE_PRIVATE_KEY");

const signed = buildSignedMigrationManifest(ids, privateKey);
if (!signed) fail("could not parse RELEASE_PRIVATE_KEY (expected an Ed25519 PEM / base64 DER / seed)");

const out = flag("out") ?? "migrations.json";
fs.writeFileSync(out, JSON.stringify(signed, null, 2) + "\n");
process.stderr.write(`sign-migrations: wrote ${out} (${signed!.migrations.length} migration(s): ${signed!.migrations.join(", ")})\n`);
