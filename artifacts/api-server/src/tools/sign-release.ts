/**
 * Release-signing CLI (docs/UPDATE-MECHANISM.md §4, phase 1) — the release/CI side of provenance.
 *
 * Signs a release manifest with the RELEASE PRIVATE KEY (never shipped) and writes the signed release JSON
 * that gets baked into the image; the runtime verifies it at boot (lib/release-provenance).
 *
 * Usage:
 *   RELEASE_PRIVATE_KEY="$(cat release.key)" \
 *   tsx src/tools/sign-release.ts --version 1.2.3 --gitSha "$(git rev-parse HEAD)" [--digest sha256:...] [--out release.json]
 *
 * The private key is an Ed25519 key as PEM (PKCS#8), base64 PKCS#8 DER, or a base64 32-byte seed — the same
 * shapes lib/signing.parsePrivateKey accepts. `--digest` is the image content digest (the promote-by-digest
 * join key); omit it when signing before the image is built and re-sign once the digest is known.
 */
import fs from "node:fs";
import { buildSignedRelease, type ReleaseManifest } from "../lib/release-provenance";

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < process.argv.length) return process.argv[i + 1];
  return process.env[`RELEASE_${name.toUpperCase()}`];
}

function fail(msg: string): never {
  process.stderr.write(`sign-release: ${msg}\n`);
  process.exit(2);
}

const version = flag("version");
const gitSha = flag("gitSha") ?? flag("gitsha");
if (!version) fail("missing --version (or RELEASE_VERSION)");
if (!gitSha) fail("missing --gitSha (or RELEASE_GITSHA)");

const privateKey = process.env["RELEASE_PRIVATE_KEY"] ?? "";
if (!privateKey.trim()) fail("missing RELEASE_PRIVATE_KEY");

const manifest: ReleaseManifest = { version: version!, gitSha: gitSha!, builtAt: new Date().toISOString() };
const digest = flag("digest");
if (digest) manifest.digest = digest;

const signed = buildSignedRelease(manifest, privateKey);
if (!signed) fail("could not parse RELEASE_PRIVATE_KEY (expected an Ed25519 PEM / base64 DER / seed)");

const out = flag("out") ?? "release.json";
fs.writeFileSync(out, JSON.stringify(signed, null, 2) + "\n");
process.stderr.write(`sign-release: wrote ${out} (version ${manifest.version}, key ${signed!.keyId})\n`);
