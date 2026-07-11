import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * End-to-end tests for the small, non-networked CLI entrypoints under scripts/src.
 *
 * Like gen-scripts.test.ts and guard-scripts.test.ts, each script is spawned as a
 * real subprocess exactly the way its `pnpm run <alias>` does — `node --import tsx
 * <script>` — so its full top-level body (argv parsing, exit codes, stdout/stderr)
 * executes under c8 via the inherited NODE_V8_COVERAGE env var. We assert exit
 * code + output only; none of these paths touch the network or write files.
 *
 * Deliberately out of scope (live-server / network harnesses): e2e-smoke,
 * stress-test, load-harness, integration-openproject, messy-resilience-probe,
 * verify-broker-contract — and src/lib/demo-session.ts, which is a network `login`
 * helper (not a CLI entrypoint; running it invokes nothing and prints nothing).
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = path.resolve(HERE, ".."); // .../scripts
const REPO_ROOT = path.resolve(SCRIPTS_DIR, ".."); // repo root
const ASSETS = path.join(REPO_ROOT, "lib", "backend-catalogue", "assets");

/** Run a script the way its pnpm alias does; returns the process result. */
function run(scriptRel: string, args: string[] = [], opts: { env?: NodeJS.ProcessEnv; input?: string } = {}) {
  return spawnSync(process.execPath, ["--import", "tsx", path.join(SCRIPTS_DIR, scriptRel), ...args], {
    cwd: SCRIPTS_DIR,
    encoding: "utf8",
    timeout: 60_000,
    ...(opts.input !== undefined ? { input: opts.input } : {}),
    env: { ...process.env, ...opts.env },
  });
}

// ---------------------------------------------------------------------------
// hello.ts
// ---------------------------------------------------------------------------
test("hello: prints its greeting and exits 0", () => {
  const r = run("src/hello.ts");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Hello from @workspace\/scripts/);
});

// ---------------------------------------------------------------------------
// verify-plane.ts
// ---------------------------------------------------------------------------
test("verify-plane: a real reports asset validates (exit 0)", () => {
  const file = path.join(ASSETS, "reports", "velocity.json");
  const r = run("src/verify-plane.ts", ["reports", file]);
  assert.equal(r.status, 0, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  assert.match(r.stdout, /valid reports entry/);
  assert.match(r.stdout, /1\/1 valid\./);
});

test("verify-plane: a real screens asset validates (exit 0)", () => {
  const file = path.join(ASSETS, "screens", "home.json");
  const r = run("src/verify-plane.ts", ["screens", file]);
  assert.equal(r.status, 0, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  assert.match(r.stdout, /valid screens entry/);
});

test("verify-plane: missing plane/file prints usage and exits 2", () => {
  const r = run("src/verify-plane.ts");
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage: verify-plane <plane> <entry\.json>/);
  // the usage lists the real plane ids
  assert.match(r.stderr, /planes: backends brokers outputs notifications methodologies reports screens/);
});

test("verify-plane: unreadable file exits 2 with an IO error", () => {
  const r = run("src/verify-plane.ts", ["reports", path.join(SCRIPTS_DIR, "does-not-exist.json")]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /cannot read\/parse/);
});

test("verify-plane: an unknown plane fails the entry and exits 1", () => {
  // A syntactically valid JSON entry, but the plane id is bogus.
  const file = path.join(ASSETS, "reports", "velocity.json");
  const r = run("src/verify-plane.ts", ["not-a-plane", file]);
  assert.equal(r.status, 1, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  assert.match(r.stderr, /unknown plane: not-a-plane/);
  assert.match(r.stdout, /0\/1 valid\./);
});

test("verify-plane: an invalid entry for a real plane exits 1 with field errors", () => {
  // A syntactically valid JSON object that is missing required reports fields.
  // Written to the OS tmpdir (never the repo) and cleaned up, so no drift.
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "verify-plane-")), "bad.json");
  fs.writeFileSync(file, JSON.stringify({ id: "totally-invalid" }));
  try {
    const r = run("src/verify-plane.ts", ["reports", file]);
    assert.equal(r.status, 1, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
    assert.match(r.stderr, /✗ totally-invalid/);
    assert.match(r.stdout, /0\/1 valid\./);
  } finally {
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// mint-license.ts (pure node:crypto — no network)
// ---------------------------------------------------------------------------
test("mint-license: no subcommand prints usage and exits 1", () => {
  const r = run("src/mint-license.ts");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /usage: mint-license\.ts <keygen\|mint>/);
});

test("mint-license: an unknown subcommand prints usage and exits 1", () => {
  const r = run("src/mint-license.ts", ["frobnicate"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /usage: mint-license\.ts <keygen\|mint>/);
});

test("mint-license: keygen prints a PEM keypair and exits 0", () => {
  const r = run("src/mint-license.ts", ["keygen"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /BEGIN PUBLIC KEY/);
  assert.match(r.stdout, /BEGIN PRIVATE KEY/);
  assert.match(r.stdout, /LICENSE_PUBLIC_KEY/);
});

test("mint-license: mint without a private key errors and exits 1", () => {
  const r = run("src/mint-license.ts", ["mint", "--customer", "Acme"], {
    env: { LICENSE_PRIVATE_KEY: "" },
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /set LICENSE_PRIVATE_KEY/);
});

test("mint-license: mint emits a well-formed, signature-valid token", () => {
  // Generate a real Ed25519 keypair in-process (no network), mint with it,
  // then verify the emitted token's signature with the matching public key.
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const privPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

  const r = run("src/mint-license.ts", [
    "mint",
    "--customer", "Acme Corp",
    "--tier", "enterprise",
    "--features", "branding,labels",
    "--days", "30",
  ], { env: { LICENSE_PRIVATE_KEY: privPem } });

  assert.equal(r.status, 0, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  assert.match(r.stdout, /Licence for Acme Corp \(enterprise\)/);
  assert.match(r.stdout, /features: branding, labels/);

  // Last non-empty stdout line is the token: prefix.payload.signature
  const token = r.stdout.trim().split("\n").filter((l) => l && !l.startsWith("#")).at(-1)!;
  assert.ok(token.startsWith("omni-lic.v1."), `unexpected token: ${token}`);
  const parts = token.split(".");
  assert.equal(parts.length, 4, "token = omni-lic . v1 . payload . sig");
  const [prefixA, prefixB, body, sig] = parts;
  const signingInput = `${prefixA}.${prefixB}.${body}`;
  const verified = crypto.verify(
    null,
    Buffer.from(signingInput),
    publicKey,
    Buffer.from(sig!, "base64url"),
  );
  assert.equal(verified, true, "emitted token signature must verify with the issuing public key");

  // Payload round-trips the CLI args.
  const payload = JSON.parse(Buffer.from(body!, "base64url").toString("utf8"));
  assert.equal(payload.customer, "Acme Corp");
  assert.equal(payload.tier, "enterprise");
  assert.deepEqual(payload.features, ["branding", "labels"]);
  assert.ok(payload.exp > payload.iat, "a positive --days must yield exp > iat");
});

// ---------------------------------------------------------------------------
// wizard/wizard.ts — interactive TUI.
//
// The full interview requires a real TTY; the wizard explicitly refuses a piped
// (non-TTY) stdin and exits 1 before writing anything. That refusal is the only
// deterministic, side-effect-free path drivable from a test, so we cover exactly
// it (piping stdin makes stdin.isTTY false). Driving the full interview is out of
// scope: it would need a pseudo-TTY and writes .env + docker-compose.yml on exit.
// ---------------------------------------------------------------------------
test("wizard: refuses a non-TTY stdin and exits 1 without writing files", () => {
  const r = run("src/wizard/wizard.ts", [], { input: "\n\n\n" });
  assert.equal(r.status, 1, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  assert.match(r.stderr, /needs an interactive terminal/);
});
