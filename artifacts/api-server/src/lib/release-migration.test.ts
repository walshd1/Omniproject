import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  registerMigration, __clearMigrations, __resetMigrationLedger, appliedMigrationIds,
  pendingMigrations, pendingIrreversibleMigrations, migrationBlockReason,
  buildSignedMigrationManifest, canonicalMigrationManifest, parseMigrationManifest,
  approvedMigrationIds, runSignedMigrations, MigrationError, type Migration,
} from "./release-migration";

/**
 * Phase-6 signed migration runner (docs/UPDATE-MECHANISM.md §8). A pending migration runs ONLY if it's named
 * in a manifest signed by the release trust root (fail-closed); a pending IRREVERSIBLE migration blocks
 * promotion; every applied migration lands in a sealed, audited ledger.
 */

function keypair() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  return {
    privPem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    pubPem: publicKey.export({ format: "pem", type: "spki" }).toString(),
  };
}

let kp: ReturnType<typeof keypair>;
let saved: Record<string, string | undefined> = {};
const applied: string[] = []; // side-effect sink so a test can prove `up` actually ran

function mig(id: string, reversible = true): Migration {
  return { id, description: id, reversible, up: () => { applied.push(id); }, ...(reversible ? { down: () => {} } : {}) };
}

before(() => { kp = keypair(); });
beforeEach(() => {
  __clearMigrations();
  __resetMigrationLedger();
  applied.length = 0;
  for (const k of ["RELEASE_MIGRATIONS", "RELEASE_MIGRATIONS_FILE", "RELEASE_PUBLIC_KEY", "RELEASE_VERIFY", "RELEASE_MANIFEST", "RELEASE_MIGRATION_LEDGER_FILE"]) {
    saved[k] = process.env[k]; delete process.env[k];
  }
});
after(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

test("canonicalMigrationManifest is order- and duplicate-independent", () => {
  assert.equal(canonicalMigrationManifest(["b", "a", "b"]), canonicalMigrationManifest(["a", "b"]));
});

test("parseMigrationManifest rejects malformed input", () => {
  assert.equal(parseMigrationManifest(null), null);
  assert.equal(parseMigrationManifest({ migrations: "x", signature: "s" }), null);
  assert.equal(parseMigrationManifest({ migrations: ["a"], signature: 1 }), null);
  assert.deepEqual(parseMigrationManifest({ migrations: ["a"], signature: "s" }), { migrations: ["a"], signature: "s" });
});

test("approvedMigrationIds returns the id set only when the manifest verifies against the trust root", () => {
  const signed = buildSignedMigrationManifest(["m1", "m2"], kp.privPem)!;
  const env = { RELEASE_PUBLIC_KEY: kp.pubPem, RELEASE_MIGRATIONS: JSON.stringify(signed) } as NodeJS.ProcessEnv;
  assert.deepEqual([...approvedMigrationIds(env)!].sort(), ["m1", "m2"]);

  // Wrong key → not approved.
  assert.equal(approvedMigrationIds({ RELEASE_PUBLIC_KEY: keypair().pubPem, RELEASE_MIGRATIONS: JSON.stringify(signed) }), null);
  // No trust root → nothing approved (fail-closed).
  assert.equal(approvedMigrationIds({ RELEASE_MIGRATIONS: JSON.stringify(signed) }), null);
  // Tampered id list → signature no longer covers it.
  const tampered = { ...signed, migrations: [...signed.migrations, "m3-injected"] };
  assert.equal(approvedMigrationIds({ RELEASE_PUBLIC_KEY: kp.pubPem, RELEASE_MIGRATIONS: JSON.stringify(tampered) }), null);
});

test("runSignedMigrations applies a signed, pending migration and ledgers it", () => {
  registerMigration(mig("m1"));
  const signed = buildSignedMigrationManifest(["m1"], kp.privPem)!;
  process.env["RELEASE_PUBLIC_KEY"] = kp.pubPem;
  process.env["RELEASE_MIGRATIONS"] = JSON.stringify(signed);

  const r = runSignedMigrations(process.env, "2026-07-25T00:00:00.000Z");
  assert.deepEqual(r.ran, ["m1"]);
  assert.deepEqual(applied, ["m1"]);
  assert.ok(appliedMigrationIds().has("m1"));
  assert.deepEqual(pendingMigrations(), []); // no longer pending
});

test("a migration NOT named in the signed manifest is refused (warn mode) / fatal (strict mode)", () => {
  registerMigration(mig("m1"));
  const signed = buildSignedMigrationManifest(["other"], kp.privPem)!; // approves a different id
  process.env["RELEASE_PUBLIC_KEY"] = kp.pubPem;
  process.env["RELEASE_MIGRATIONS"] = JSON.stringify(signed);

  // warn/off (default): refused, left pending, not run.
  const r = runSignedMigrations(process.env, "2026-07-25T00:00:00.000Z");
  assert.deepEqual(r.ran, []);
  assert.equal(r.refused[0]?.id, "m1");
  assert.deepEqual(applied, []);
  assert.ok(!appliedMigrationIds().has("m1"));

  // strict: fail-closed.
  process.env["RELEASE_VERIFY"] = "strict";
  assert.throws(() => runSignedMigrations(process.env, "2026-07-25T00:00:00.000Z"), MigrationError);
});

test("with NO signed manifest at all, pending migrations never run (fail-closed)", () => {
  registerMigration(mig("m1"));
  const r = runSignedMigrations(process.env, "2026-07-25T00:00:00.000Z");
  assert.deepEqual(r.ran, []);
  assert.equal(r.refused[0]?.reason, "no verified signed migration manifest present");
});

test("an empty registry is a no-op", () => {
  const r = runSignedMigrations(process.env, "2026-07-25T00:00:00.000Z");
  assert.deepEqual(r, { ran: [], refused: [] });
});

test("a pending IRREVERSIBLE migration blocks promotion; a reversible one does not", () => {
  assert.equal(migrationBlockReason(), null);
  registerMigration(mig("rev", true));
  assert.equal(migrationBlockReason(), null); // reversible pending → still safe

  registerMigration(mig("irrev", false));
  assert.equal(pendingIrreversibleMigrations().map((m) => m.id).join(","), "irrev");
  assert.match(migrationBlockReason() ?? "", /pending irreversible migration/);
});

test("registerMigration rejects a duplicate id", () => {
  registerMigration(mig("dup"));
  assert.throws(() => registerMigration(mig("dup")), /duplicate migration id/);
});
