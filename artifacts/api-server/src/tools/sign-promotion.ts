/**
 * Promotion-signing CLI (docs/UPDATE-MECHANISM.md §3, phase 2) — records "production = this digest".
 *
 * Signs a PromotionRecord naming the approved image digest with the release/promotion PRIVATE key, and writes
 * the signed promotion JSON. The deploy/admission layer verifies it against the trust root and pins the
 * runtime to that digest (RELEASE_EXPECTED_DIGEST); admitBuild refuses any build whose digest differs.
 *
 * Usage:
 *   RELEASE_PRIVATE_KEY="$(cat release.key)" \
 *   tsx src/tools/sign-promotion.ts --digest sha256:abc… [--note "org accepted"] [--out promotion.json]
 */
import fs from "node:fs";
import { buildSignedPromotion, type PromotionRecord } from "../lib/release-provenance";

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < process.argv.length) return process.argv[i + 1];
  return process.env[`RELEASE_${name.toUpperCase()}`];
}
function fail(msg: string): never { process.stderr.write(`sign-promotion: ${msg}\n`); process.exit(2); }

const digest = flag("digest");
if (!digest) fail("missing --digest (or RELEASE_DIGEST) — the approved image content digest, e.g. sha256:…");

const privateKey = process.env["RELEASE_PRIVATE_KEY"] ?? "";
if (!privateKey.trim()) fail("missing RELEASE_PRIVATE_KEY");

const record: PromotionRecord = { digest: digest!, promotedAt: new Date().toISOString() };
const note = flag("note");
if (note) record.note = note;

const signed = buildSignedPromotion(record, privateKey);
if (!signed) fail("could not parse RELEASE_PRIVATE_KEY (expected an Ed25519 PEM / base64 DER / seed)");

const out = flag("out") ?? "promotion.json";
fs.writeFileSync(out, JSON.stringify(signed, null, 2) + "\n");
process.stderr.write(`sign-promotion: wrote ${out} (digest ${record.digest}, key ${signed!.keyId})\n`);
