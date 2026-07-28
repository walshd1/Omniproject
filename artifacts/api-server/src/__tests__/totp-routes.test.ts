// Configure the sealed 2FA store for this test process BEFORE the app (and its lazy env reads) boot.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const totpDir = mkdtempSync(join(tmpdir(), "totp-routes-"));
process.env["TOTP_FILE"] = join(totpDir, "totp.sealed");
process.env["TOTP_SECRET"] = "test-totp-root-secret-not-real";

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startHarness, memberCookie, type Harness } from "./_harness";
import { totpCode } from "../lib/totp";

/**
 * routes/auth.ts TOTP block over the REAL app: enrol → confirm (with a live authenticator code) → status →
 * step-up (a fresh code, then a replay) → disable (via a recovery code). Proves the enrol/verify flow, the
 * single-use replay lock, and that a wrong code is refused.
 */
let h: Harness;
const nowSec = () => Math.floor(Date.now() / 1000);

before(async () => { h = await startHarness(); });
after(() => { h?.close(); rmSync(totpDir, { recursive: true, force: true }); });

const post = (path: string, body?: unknown) => h.req(path, { method: "POST", cookie: memberCookie(), body });

test("enrol → confirm → status → step-up (+ replay reject) → disable", async () => {
  // 1. Enrol: get a secret + otpauth URI, not yet active.
  const enrol = await post("/auth/totp/enrol");
  assert.equal(enrol.status, 200);
  const { secret, otpauthUrl } = (await enrol.json()) as { secret: string; otpauthUrl: string };
  assert.match(secret, /^[A-Z2-7]+$/);
  assert.match(otpauthUrl, /^otpauth:\/\/totp\//);

  const status0 = await (await h.req("/auth/totp/status", { cookie: memberCookie() })).json() as { enrolled: boolean; pending: boolean };
  assert.deepEqual([status0.enrolled, status0.pending], [false, true]);

  // 2. A wrong code is refused.
  assert.equal((await post("/auth/totp/confirm", { code: "000000" })).status, 400);

  // 3. Confirm with a live code → active, and 10 one-time recovery codes come back.
  const confirm = await post("/auth/totp/confirm", { code: totpCode(secret, nowSec()) });
  assert.equal(confirm.status, 200);
  const { recoveryCodes } = (await confirm.json()) as { recoveryCodes: string[] };
  assert.equal(recoveryCodes.length, 10);

  const status1 = await (await h.req("/auth/totp/status", { cookie: memberCookie() })).json() as { enrolled: boolean; recoveryRemaining: number };
  assert.equal(status1.enrolled, true);
  assert.equal(status1.recoveryRemaining, 10);

  // 4. Step-up with a code from the NEXT step (beyond the one the confirm consumed).
  const stepCode = totpCode(secret, nowSec() + 30);
  assert.equal((await post("/auth/totp/step-up", { code: stepCode })).status, 200);
  // The same code can't be replayed inside its window (the step is already consumed).
  assert.equal((await post("/auth/totp/step-up", { code: stepCode })).status, 401);

  // 5. Disable using a recovery code.
  assert.equal((await post("/auth/totp/disable", { recoveryCode: recoveryCodes[0] })).status, 200);
  const status2 = await (await h.req("/auth/totp/status", { cookie: memberCookie() })).json() as { enrolled: boolean };
  assert.equal(status2.enrolled, false);
});

test("step-up before enrolment is 409 (needs an enrolled authenticator)", async () => {
  const r = await post("/auth/totp/step-up", { code: "123456" });
  assert.equal(r.status, 409);
  assert.equal((await r.json() as { needsEnrolment?: boolean }).needsEnrolment, true);
});

test("the routes require a session (401 when signed out)", async () => {
  const r = await h.req("/auth/totp/enrol", { method: "POST" });
  assert.equal(r.status, 401);
});
