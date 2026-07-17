import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildFullBackup, splitFullBackup, FULL_BACKUP_SCHEMA,
  buildSealedFullBackup, isSealedFullBackup, openSealedFullBackup, SEALED_BACKUP_SCHEMA, SealedBackupError,
} from "./full-backup";
import type { SettingsState } from "./settings";

/** Full backup (roadmap X.14) — the one-file composition of the settings snapshot + the def-store export. */

/** A settings object carrying a SECRET (a webhook signing secret) so the plaintext-vs-sealed split is testable. */
const withSecret = { branding: { productName: "X" }, webhooks: [{ id: "w", url: "https://hook.example", secret: "s3cr3t", active: true }] } as unknown as SettingsState;

test("buildFullBackup composes both halves under the full-backup schema", () => {
  const settings = { branding: { productName: "X" } } as unknown as SettingsState;
  const b = buildFullBackup(settings, "2026-07-17T00:00:00.000Z");
  assert.equal(b.schema, FULL_BACKUP_SCHEMA);
  assert.equal(b.createdAt, "2026-07-17T00:00:00.000Z");
  assert.equal(b.settings.schema, "omniproject/config-snapshot");
  assert.equal(b.defStore.schema, "omniproject/def-store-export");
});

test("splitFullBackup returns the two halves for a valid envelope", () => {
  const env = { schema: FULL_BACKUP_SCHEMA, version: 1, createdAt: "t", settings: { a: 1 }, defStore: { b: 2 } };
  const { settings, defStore } = splitFullBackup(env);
  assert.deepEqual(settings, { a: 1 });
  assert.deepEqual(defStore, { b: 2 });
});

test("splitFullBackup throws on a wrong or missing schema", () => {
  assert.throws(() => splitFullBackup({ schema: "nope" }), /schema/i);
  assert.throws(() => splitFullBackup(null), /object/i);
});

test("PLAINTEXT backup withholds secrets; SEALED backup carries them and round-trips under the deployment key", () => {
  // Plaintext: the webhook secret is NOT in the settings snapshot.
  const plain = buildFullBackup(withSecret, "2026-07-17T00:00:00.000Z");
  assert.equal("webhooks" in (plain.settings.settings as Record<string, unknown>), false, "plaintext backup must not carry secret-bearing keys");

  // Sealed: an encrypted envelope, ciphertext only — no plaintext secret visible on the wire.
  const sealed = buildSealedFullBackup(withSecret, "2026-07-17T00:00:00.000Z");
  assert.equal(sealed.schema, SEALED_BACKUP_SCHEMA);
  assert.ok(isSealedFullBackup(sealed));
  assert.ok(typeof sealed.keyFingerprint === "string" && sealed.keyFingerprint.length > 0);
  assert.equal(JSON.stringify(sealed).includes("s3cr3t"), false, "the sealed envelope must not leak the secret in clear");

  // Open with this deployment's key: the complete state comes back, secret included.
  const { settings } = openSealedFullBackup(sealed);
  const snap = settings as { settings: Record<string, unknown> };
  const webhooks = snap.settings["webhooks"] as { secret: string }[];
  assert.equal(webhooks[0]!.secret, "s3cr3t", "the sealed backup carries the secret so a full restore is complete");
});

test("openSealedFullBackup rejects a non-sealed envelope and a corrupted token", () => {
  assert.throws(() => openSealedFullBackup({ schema: "omniproject/full-backup" }), SealedBackupError);
  const sealed = buildSealedFullBackup(withSecret, "2026-07-17T00:00:00.000Z");
  const tampered = { ...sealed, sealed: sealed.sealed.slice(0, -4) + "AAAA" }; // break the AES-GCM tag
  assert.throws(() => openSealedFullBackup(tampered), SealedBackupError);
});
