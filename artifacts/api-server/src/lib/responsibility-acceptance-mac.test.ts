// Deterministic internal key so derivedKey("acceptance") is stable — set BEFORE importing anything that reads it.
process.env["SESSION_SECRET"] = "test-acceptance-mac-secret-do-not-use";

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { updateSettings } from "./settings";
import { workflowContentHash, type WorkflowAcceptance } from "./responsibility-acceptance";
import { activeAcceptanceFor, aiApprovalAuthorization } from "./responsibility-acceptance-service";
import { derivedKey } from "./key-registry";
import { canonicalJson } from "./canonical-json";

/**
 * Acceptance-forgery MAC (re-land of pass-2 P2). A workflow responsibility-acceptance authorises an AI to
 * auto-approve. It is minted only by the passkey-signing flow, which binds it with a keyed MAC under the
 * internal key. An acceptance INJECTED some other way — a hand-edited settings blob, a config-dir drop —
 * never went through that flow, carries no valid MAC, and MUST be treated as void (not trusted to grant AI
 * autonomy). This proves a forged/mac-less/mac-wrong acceptance is rejected, and a correctly-MAC'd one works.
 */

const WF = { id: "wf-1", scope: { kind: "org" as const }, steps: [] };
const HASH = workflowContentHash(WF);
const validMac = (a: Pick<WorkflowAcceptance, "workflowId" | "workflowHash" | "acceptedBy" | "sigRef" | "acceptedAt">): string =>
  createHmac("sha256", derivedKey("acceptance"))
    .update(canonicalJson({ workflowId: a.workflowId, workflowHash: a.workflowHash, acceptedBy: a.acceptedBy, sigRef: a.sigRef, acceptedAt: a.acceptedAt }))
    .digest("hex");
const base = { workflowId: "wf-1", workflowHash: HASH, acceptedBy: "u-signer", sigRef: "sig-1", acceptedAt: "2026-01-01T00:00:00.000Z" };

beforeEach(() => { updateSettings({ workflows: [WF], workflowAcceptances: [] }); });

test("a MAC-LESS injected acceptance is void — the AI grant is NOT honoured (forgery closed)", () => {
  updateSettings({ workflowAcceptances: [{ ...base }] }); // no mac (settings/config-dir injection)
  assert.equal(activeAcceptanceFor("wf-1"), null);
  assert.equal(aiApprovalAuthorization("wf-1").ok, false);
});

test("a WRONG-MAC acceptance is void", () => {
  updateSettings({ workflowAcceptances: [{ ...base, mac: "deadbeef" }] });
  assert.equal(activeAcceptanceFor("wf-1"), null);
  assert.equal(aiApprovalAuthorization("wf-1").ok, false);
});

test("a correctly-MAC'd acceptance IS honoured (the gate doesn't break legitimate acceptances)", () => {
  updateSettings({ workflowAcceptances: [{ ...base, mac: validMac(base) }] });
  assert.equal(activeAcceptanceFor("wf-1")?.acceptedBy, "u-signer");
  assert.equal(aiApprovalAuthorization("wf-1").ok, true);
});

test("a valid MAC over a DIFFERENT workflow hash is void (can't be replayed onto an edited workflow)", () => {
  const stale = { ...base, workflowHash: workflowContentHash({ ...WF, steps: [{ id: "s1", kind: "action" as const, action: "noop" }] }) };
  updateSettings({ workflowAcceptances: [{ ...stale, mac: validMac(stale) }] });
  assert.equal(activeAcceptanceFor("wf-1"), null); // MAC is valid but bound to a hash that no longer matches
});
