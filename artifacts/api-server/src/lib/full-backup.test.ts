import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFullBackup, splitFullBackup, FULL_BACKUP_SCHEMA } from "./full-backup";
import type { SettingsState } from "./settings";

/** Full backup (roadmap X.14) — the one-file composition of the settings snapshot + the def-store export. */

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
