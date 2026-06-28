#!/usr/bin/env node
// Offline decrypt for an exported config bundle. Self-contained (Node only, no deps, no
// env master) so an operator can run it anywhere to turn an `e1.` bundle back into the
// plaintext config JSON, then drop that file into place on the target — which re-seals it
// under the target's OWN internal key on the next write (rekey-for-internal is automatic).
//
//   node decrypt-config-bundle.mjs <bundle-file> <ephemeral-key-base64> [out-file]
//
// The bundle + key come from POST /api/security/config/export. Move the bundle file and
// carry the key separately; this never touches the internal at-rest key.
import { readFileSync, writeFileSync } from "node:fs";
import { createDecipheriv } from "node:crypto";

const [, , bundleFile, keyB64, outFile] = process.argv;
if (!bundleFile || !keyB64) {
  console.error("usage: node decrypt-config-bundle.mjs <bundle-file> <ephemeral-key-base64> [out-file]");
  process.exit(2);
}

const token = readFileSync(bundleFile, "utf8").trim();
if (!token.startsWith("e1.")) { console.error("not a config export bundle (expected an 'e1.' token)"); process.exit(1); }

const key = Buffer.from(keyB64, "base64");
if (key.length !== 32) { console.error("the key must be a base64-encoded 32-byte value"); process.exit(1); }

let plaintext;
try {
  const raw = Buffer.from(token.slice("e1.".length), "base64url");
  const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  plaintext = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
} catch {
  console.error("decryption failed — wrong key, or the bundle was altered (authentication tag mismatch)");
  process.exit(1);
}

if (outFile) { writeFileSync(outFile, plaintext); console.error(`wrote ${outFile}`); }
else process.stdout.write(plaintext);
