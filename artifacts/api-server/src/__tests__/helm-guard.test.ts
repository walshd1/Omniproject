import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * Helm-chart guard — the deploy-guard idea applied to the Kubernetes Helm chart under
 * deploy/helm/omniproject. No `helm` binary is assumed (CI/local may not have it), so these
 * are pure fs/regex invariants that keep the chart from silently rotting away from the app's
 * contract the way N8N_WEBHOOK_URL once did in the compose/k8s files:
 *
 *   A. The expected chart files all exist (Chart/values + the core templates).
 *   B. The chart wires the broker under its CURRENT name (BROKER_URL) and the renamed
 *      N8N_WEBHOOK_URL never reappears.
 *   C. Probes point at the real liveness/readiness endpoints (/api/healthz, /api/readyz).
 *   D. OTLP telemetry is OFF by default and gated on an endpoint (additive, opt-in).
 *   E. SESSION_SECRET ships EMPTY (fail-fast fires) and the pod runs hardened (non-root,
 *      read-only rootfs, drop ALL caps) — matching the stateless posture.
 */

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../..");
const CHART = "deploy/helm/omniproject";
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), "utf8");

const TEMPLATES = ["deployment", "service", "ingress", "hpa", "configmap", "secret"];

// ── A. Expected files exist ────────────────────────────────────────────────────
test("helm guard: chart + core templates exist", () => {
  const missing: string[] = [];
  for (const f of [`${CHART}/Chart.yaml`, `${CHART}/values.yaml`, `${CHART}/templates/_helpers.tpl`]) {
    if (!fs.existsSync(path.join(ROOT, f))) missing.push(f);
  }
  for (const t of TEMPLATES) {
    if (!fs.existsSync(path.join(ROOT, `${CHART}/templates/${t}.yaml`))) missing.push(`${CHART}/templates/${t}.yaml`);
  }
  assert.deepEqual(missing, [], `Missing chart files: ${missing.join(", ")}`);
});

// ── B. Broker wired under the current name; the removed name never resurfaces ───
test("helm guard: values set BROKER_URL and never N8N_WEBHOOK_URL", () => {
  const values = read(`${CHART}/values.yaml`);
  assert.match(values, /\bBROKER_URL\b/, "values.yaml must set BROKER_URL");
  const offenders: string[] = [];
  for (const rel of [`${CHART}/values.yaml`, `${CHART}/templates/configmap.yaml`]) {
    read(rel).split("\n").forEach((line, i) => {
      if (/\bN8N_WEBHOOK_URL\b/.test(line) && !/#.*\bwas\s+N8N_WEBHOOK_URL\b/.test(line)) offenders.push(`${rel}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, [], `Removed env N8N_WEBHOOK_URL resurfaced: ${offenders.join(", ")}`);
});

// ── C. Probes hit the real liveness/readiness endpoints ────────────────────────
test("helm guard: probes point at /api/healthz (liveness) + /api/readyz (readiness)", () => {
  const values = read(`${CHART}/values.yaml`);
  assert.match(values, /\/api\/healthz/, "startup/liveness probe must use /api/healthz");
  assert.match(values, /\/api\/readyz/, "readiness probe must use /api/readyz");
  const dep = read(`${CHART}/templates/deployment.yaml`);
  for (const p of ["startupProbe", "livenessProbe", "readinessProbe"]) {
    assert.match(dep, new RegExp(p), `deployment.yaml must define ${p}`);
  }
});

// ── D. OTLP telemetry off by default, gated on an endpoint ─────────────────────
test("helm guard: OTLP export is OFF by default and gated on an endpoint", () => {
  const values = read(`${CHART}/values.yaml`);
  assert.match(values, /otel:\s*\n(?:.*\n)*?\s*enabled:\s*false/, "otel.enabled must default to false");
  const cm = read(`${CHART}/templates/configmap.yaml`);
  assert.match(cm, /if and \.Values\.otel\.enabled \.Values\.otel\.endpoint/, "OTLP env must be gated on otel.enabled AND an endpoint");
  assert.match(cm, /OTEL_EXPORTER_OTLP_ENDPOINT/, "configmap must wire OTEL_EXPORTER_OTLP_ENDPOINT when enabled");
});

// ── E. Secret empty by default; pod hardened ───────────────────────────────────
test("helm guard: SESSION_SECRET ships empty and the pod is hardened", () => {
  const values = read(`${CHART}/values.yaml`);
  assert.match(values, /SESSION_SECRET:\s*""/, "SESSION_SECRET must ship empty so the prod fail-fast fires");
  assert.match(values, /readOnlyRootFilesystem:\s*true/, "container must run with a read-only root filesystem");
  assert.match(values, /runAsNonRoot:\s*true/, "pod must run as non-root");
  assert.match(values, /drop:\s*\n\s*-\s*ALL/, "container must drop ALL capabilities");
});
