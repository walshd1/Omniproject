import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  dlpEnabled, redactText, redactForEgress, modelAllowed, tokenBudget, estimateTokens,
  checkBudget, recordUsage, aiGovernanceStatus, aiUsageReport,
} from "./ai-governance";
import { __resetSharedStateForTest, sharedKv } from "./shared-state";

const ENV = ["AI_DLP_REDACT", "AI_MODEL_ALLOWLIST", "AI_TOKEN_BUDGET", "AI_BUDGET_WINDOW_HOURS"];
afterEach(async () => { for (const k of ENV) delete process.env[k]; await sharedKv.clear(); __resetSharedStateForTest(); });

// ── DLP redaction ─────────────────────────────────────────────────────────────────
test("dlp is off by default, on with AI_DLP_REDACT=true", () => {
  assert.equal(dlpEnabled(), false);
  process.env["AI_DLP_REDACT"] = "true";
  assert.equal(dlpEnabled(), true);
});

test("redactText masks emails, cards, secrets and bearer tokens", () => {
  const r = redactText("mail me a@b.co, card 4111 1111 1111 1111, key sk-abcdefghij0123456789, Authorization: Bearer abcdef0123456789");
  assert.match(r.text, /\[redacted-email\]/);
  assert.match(r.text, /\[redacted-card\]/);
  assert.match(r.text, /\[redacted-secret\]/);
  assert.match(r.text, /Bearer \[redacted-token\]/);
  assert.doesNotMatch(r.text, /a@b\.co|sk-abcdef/);
  assert.ok(r.redactions >= 4);
});

test("redactForEgress preserves message shape and counts redactions", () => {
  const out = redactForEgress([{ role: "user", content: "ping x@y.z" }, { role: "system", content: "no pii here" }]);
  assert.equal(out.messages[0]!.role, "user"); // shape preserved
  assert.match(out.messages[0]!.content, /\[redacted-email\]/);
  assert.equal(out.messages[1]!.content, "no pii here");
  assert.equal(out.redactions, 1);
});

// ── Per-role model allowlist ────────────────────────────────────────────────────────
test("modelAllowed is permissive without config, enforces per role when set", () => {
  assert.equal(modelAllowed("viewer", "gpt-4o"), true); // no allowlist ⇒ allow
  process.env["AI_MODEL_ALLOWLIST"] = "viewer=gpt-4o-mini,admin=*";
  assert.equal(modelAllowed("viewer", "gpt-4o"), false); // not in viewer's list
  assert.equal(modelAllowed("viewer", "gpt-4o-mini"), true);
  assert.equal(modelAllowed("admin", "anything"), true); // wildcard
  assert.equal(modelAllowed("manager", "gpt-4o"), true); // unlisted role ⇒ unrestricted
});

// ── Token budget (shared-state backed) ───────────────────────────────────────────────
test("estimateTokens approximates chars/4", () => {
  assert.equal(estimateTokens([{ content: "12345678" }]), 2);
});

test("budget is unlimited until configured, then checked + recorded per scope", async () => {
  assert.equal(tokenBudget(), 0);
  assert.equal((await checkBudget("alice", 999_999)).ok, true); // no budget ⇒ always ok

  process.env["AI_TOKEN_BUDGET"] = "100";
  assert.deepEqual(await checkBudget("alice", 40), { ok: true, used: 0, limit: 100 });
  await recordUsage("alice", 80);
  assert.equal((await checkBudget("alice", 40)).ok, false); // 80 + 40 > 100
  assert.equal((await checkBudget("alice", 20)).ok, true);  // 80 + 20 == 100
  assert.equal((await checkBudget("bob", 100)).ok, true);   // separate scope

  const usage = await aiUsageReport();
  assert.deepEqual(usage, [{ scope: "alice", tokens: 80 }]);
});

test("governance status reflects configured policy", () => {
  process.env["AI_DLP_REDACT"] = "true";
  process.env["AI_MODEL_ALLOWLIST"] = "admin=*";
  process.env["AI_TOKEN_BUDGET"] = "5000";
  const s = aiGovernanceStatus();
  assert.equal(s.dlp, true);
  assert.deepEqual(s.modelAllowlist, { admin: "*" });
  assert.equal(s.budget.limit, 5000);
  assert.equal(s.budget.windowHours, 24);
});
