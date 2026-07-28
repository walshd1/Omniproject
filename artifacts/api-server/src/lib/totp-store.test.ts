import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Point the sealed store at a throwaway file + give it an independent root key BEFORE the store reads env.
const dir = mkdtempSync(join(tmpdir(), "totp-store-"));
process.env["TOTP_FILE"] = join(dir, "totp.sealed");
process.env["TOTP_SECRET"] = "test-totp-root-secret-not-real";

import {
  totpStoreEnabled,
  beginEnrolment,
  confirmEnrolment,
  getTotp,
  hasTotp,
  totpStatus,
  recordStep,
  consumeRecovery,
  disableTotp,
  _resetTotpCache,
} from "./totp-store";
import { generateTotpSecret } from "./totp";

const SUB = "user:alice";
const NOW = 1_700_000_000_000;
const RECOVERY = ["aaaa-bbbb-cccc-dddd", "eeee-ffff-gggg-hhhh"];

beforeEach(() => {
  _resetTotpCache();
  disableTotp(SUB); // clean slate (also exercises delete)
});
after(() => rmSync(dir, { recursive: true, force: true }));

test("the store is enabled when a file path resolves", () => {
  assert.equal(totpStoreEnabled(), true);
});

test("enrol → confirm activates 2FA and persists across a cache reset (sealed round-trip)", () => {
  const secret = generateTotpSecret();
  beginEnrolment(SUB, secret, NOW);
  assert.deepEqual(totpStatus(SUB), { enrolled: false, pending: true, recoveryRemaining: 0 });
  assert.equal(hasTotp(SUB), false);

  assert.equal(confirmEnrolment(SUB, RECOVERY, 42, NOW), true);
  _resetTotpCache(); // force a re-read from the sealed file
  assert.equal(hasTotp(SUB), true);
  const rec = getTotp(SUB)!;
  assert.equal(rec.secret, secret); // secret survived the seal/open round-trip
  assert.equal(rec.lastStep, 42);
  assert.deepEqual(totpStatus(SUB), { enrolled: true, pending: false, recoveryRemaining: 2 });
});

test("beginEnrolment refuses to overwrite an active enrolment (no silent 2FA reset)", () => {
  beginEnrolment(SUB, generateTotpSecret(), NOW);
  confirmEnrolment(SUB, RECOVERY, 1, NOW);
  assert.throws(() => beginEnrolment(SUB, generateTotpSecret(), NOW), /already enabled/);
});

test("recordStep advances the replay lock but never moves it backwards", () => {
  beginEnrolment(SUB, generateTotpSecret(), NOW);
  confirmEnrolment(SUB, RECOVERY, 100, NOW);
  recordStep(SUB, 105);
  assert.equal(getTotp(SUB)!.lastStep, 105);
  recordStep(SUB, 103); // a replay/older step must not move the lock
  assert.equal(getTotp(SUB)!.lastStep, 105);
});

test("consumeRecovery matches a code once, then it's gone; a wrong code is rejected", () => {
  beginEnrolment(SUB, generateTotpSecret(), NOW);
  confirmEnrolment(SUB, RECOVERY, 1, NOW);
  assert.equal(consumeRecovery(SUB, "AAAA-BBBB-CCCC-DDDD"), true); // case/format-insensitive
  assert.equal(consumeRecovery(SUB, "aaaabbbbccccdddd"), false);   // already consumed
  assert.equal(consumeRecovery(SUB, "zzzz-zzzz-zzzz-zzzz"), false); // never issued
  assert.equal(totpStatus(SUB).recoveryRemaining, 1);
});

test("disableTotp removes the enrolment", () => {
  beginEnrolment(SUB, generateTotpSecret(), NOW);
  confirmEnrolment(SUB, RECOVERY, 1, NOW);
  assert.equal(disableTotp(SUB), true);
  assert.equal(hasTotp(SUB), false);
  assert.equal(disableTotp(SUB), false); // idempotent
});
