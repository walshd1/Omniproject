import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { buildPortableBackup, openPortableBackup, isPortableBackup, PortableBackupError, PORTABLE_BACKUP_SCHEMA } from "./instance-backup";
import type { SettingsState } from "./settings";

const settings = { deploymentProfile: "business", reportingCurrency: "USD" } as unknown as SettingsState;
const now = "2026-07-19T00:00:00.000Z";
const irk = crypto.randomBytes(32);

test("build → open round-trips the full backup under the IRK", () => {
  const backup = buildPortableBackup(settings, now, irk);
  assert.equal(backup.schema, PORTABLE_BACKUP_SCHEMA);
  assert.ok(isPortableBackup(backup));
  // Ciphertext only — the settings values never appear in the sealed envelope.
  assert.equal(JSON.stringify(backup).includes("\"USD\""), false);

  const { settings: s, defStore } = openPortableBackup(backup, irk);
  assert.ok(s && typeof s === "object");
  assert.ok(defStore && typeof defStore === "object");
});

test("a WRONG key can't open it (fail-closed)", () => {
  const backup = buildPortableBackup(settings, now, irk);
  assert.throws(() => openPortableBackup(backup, crypto.randomBytes(32)), PortableBackupError);
});

test("a non-envelope is rejected", () => {
  assert.equal(isPortableBackup({ schema: "nope" }), false);
  assert.throws(() => openPortableBackup({ foo: 1 }, irk), /portable-backup envelope/);
});
