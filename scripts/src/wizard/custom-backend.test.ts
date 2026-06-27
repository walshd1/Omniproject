import { test } from "node:test";
import assert from "node:assert/strict";
import { isCustomBackend, renderSkeletonWorkflow, renderKnownWorkflow, renderBindingGuide, renderManifestSource, renderFieldMap, SKELETON_ACTIONS } from "./custom-backend";

test("isCustomBackend: true for 'custom' / unknown, false for a shipped backend", () => {
  assert.equal(isCustomBackend("custom"), true);
  assert.equal(isCustomBackend("totally-unknown-xyz"), true);
  assert.equal(isCustomBackend("jira"), false);
});

test("the skeleton workflow is valid importable n8n JSON with a node per action", () => {
  const json = renderSkeletonWorkflow("acme-pm", "Acme PM");
  const wf = JSON.parse(json) as { nodes: { name: string; type: string }[]; connections: Record<string, unknown> };
  assert.ok(Array.isArray(wf.nodes) && wf.nodes.length > SKELETON_ACTIONS.length); // webhook + route + per-action + respond
  assert.ok(wf.nodes.some((n) => n.type === "n8n-nodes-base.webhook"), "has the inbound webhook");
  // Every contract action the skeleton promises shows up as a node.
  for (const a of SKELETON_ACTIONS) {
    assert.ok(JSON.stringify(wf).includes(a.action), `workflow references ${a.action}`);
  }
  // Placeholder URLs point at the operator's CUSTOM_API_BASE, not a real host.
  assert.match(json, /CUSTOM_API_BASE/);
});

test("renderKnownWorkflow returns a workflow for a shipped backend, null for custom", () => {
  assert.ok(renderKnownWorkflow("jira"));
  assert.equal(renderKnownWorkflow("custom"), null);
});

test("the catalogue-entry stub is a BackendManifest with a mapping per action", () => {
  const src = renderManifestSource("acme-pm", "Acme PM");
  assert.match(src, /id: "acme-pm"/);
  assert.match(src, /label: "Acme PM"/);
  assert.match(src, /capabilities:/);
  for (const a of SKELETON_ACTIONS) assert.ok(src.includes(`${a.action}:`), `manifest has ${a.action}`);
  assert.match(src, /BACKENDS array/); // points the operator at where to paste it
});

test("the field-map stub is valid BackendFieldMap JSON with core on, advanced off", () => {
  const map = JSON.parse(renderFieldMap("acme-pm")) as { fields: Record<string, { surface: boolean; store: boolean }>; entities: Record<string, unknown> };
  assert.equal(map.fields["title"]!.surface, true);     // core field on
  assert.equal(map.fields["title"]!.store, true);
  assert.equal(map.fields["budget"]!.surface, false);   // advanced (financial) off until enabled
  assert.ok("project" in map.entities && "issue" in map.entities);
});

test("the binding guide walks through API discovery, auth, normalisation, field discovery, verify", () => {
  const md = renderBindingGuide("acme-pm", "Acme PM");
  assert.match(md, /# Onboarding a new backend: Acme PM/);
  assert.match(md, /CUSTOM_API_BASE/);            // step 2 API discovery
  assert.match(md, /Bearer/);                      // step 3 auth
  assert.match(md, /\/api\/contract/);             // step 4 normalisation
  assert.match(md, /describe . reconcile/i);       // step 5 field discovery
  assert.match(md, /SMOKE_BROKER_URL/);            // step 6 verify
  assert.match(md, /BACKEND_SOURCE=acme-pm/);      // labelling
});
