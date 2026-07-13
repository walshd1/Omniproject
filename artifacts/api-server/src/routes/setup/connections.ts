/**
 * Setup connections plane — the broker-facing wiring surface: the non-destructive broker/webhook
 * reachability + capability probes, the vendor-credential templates + delegated-vault relay, and the
 * n8n workflow generation/verification. Split out of the setup god router (Stage 3) as one cohesive
 * concern: everything here talks to (or emits config for) the broker, and shares the SSRF/egress
 * discipline (safeFetch / assertEgressAllowed) that admin-pasted URLs demand.
 *
 * Mounted by ./setup.ts under the same base, so every path stays `/setup/...` exactly as before.
 */
import { Router } from "express";
import { getSettings } from "../../lib/settings";
import { v, parseOr400 } from "../../lib/validate";
import { assertEgressAllowed, safeFetch, EgressError } from "../../lib/egress";
import { contextFromReq, brokerVerifyConnection, brokerStoreCredential, callBrokerCapability, probeVerifiableActions } from "../../broker";
import { requireRole } from "../../lib/rbac";
import { requireStepUp } from "../../lib/step-up";
import { requiredCredentials, renderCredentialTemplate } from "../../lib/connection-credentials";
import { getBackend, isEnterpriseBackend, generateWorkflow } from "@workspace/backend-catalogue";
import { isEntitled, resolveLicense } from "../../lib/license";
import { isTimeoutError } from "../../lib/timeout-error";

// Typed + bounded bodies for the broker-credential routes (untrusted admin input).
const CONNECTION_TEST_BODY = v.object({ backend: v.string({ trim: true, min: 1, max: 100 }) });
const CONNECTION_VAULT_BODY = v.object({
  backend: v.string({ trim: true, min: 1, max: 100 }),
  name: v.string({ trim: true, min: 1, max: 200 }),
  value: v.string({ min: 1, max: 8_000 }), // a secret — not trimmed
});

const router = Router();

// POST /api/setup/test-broker — non-destructive reachability + capability probe of
// a candidate broker webhook URL (does NOT change settings). Admin only.
router.post("/setup/test-broker", requireRole("admin"), async (req, res) => {
  const url = typeof req.body?.webhookUrl === "string" ? req.body.webhookUrl.trim() : "";
  if (!url || !/^https?:\/\//i.test(url)) {
    res.status(400).json({ reachable: false, error: "Provide an absolute http(s) webhook URL" });
    return;
  }

  try {
    // safeFetch (not a bare fetch after a one-shot check): it pins the validated IPs and re-validates
    // every redirect hop, so an admin-pasted probe URL can't be rebound or 302-redirected to metadata.
    const r = await safeFetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-OmniProject-Action": "get_capabilities",
        "X-OmniProject-Source": "capability_probe",
        "X-OmniProject-Origin": "omniproject",
      },
      body: JSON.stringify({ action: "get_capabilities", payload: {}, source: "capability_probe", origin: "omniproject" }),
      signal: AbortSignal.timeout(8_000),
    });

    if (!r.ok) {
      res.json({ reachable: true, ok: false, status: r.status, error: `Webhook responded ${r.status}` });
      return;
    }

    const json = (await r.json().catch(() => ({}))) as { data?: Record<string, boolean>; success?: boolean };
    const capabilities = json && typeof json === "object" && json.data && typeof json.data === "object" ? json.data : null;
    res.json({
      reachable: true,
      ok: true,
      status: r.status,
      implementsCapabilities: !!capabilities,
      capabilities,
    });
  } catch (err) {
    if (err instanceof EgressError) {
      res.json({ reachable: false, error: err.message });
      return;
    }
    const isTimeout = isTimeoutError(err);
    res.json({ reachable: false, error: isTimeout ? "Connection timed out" : "Could not reach the webhook URL" });
  }
});

// GET /api/setup/connections?backends=a,b — the vendor credentials the broker(s)
// need for the selected backends, plus fill-in templates. Admin-only. Returns only
// credential NAMES + placeholders; OmniProject never holds the secret values.
router.get("/setup/connections", requireRole("admin"), (req, res) => {
  const raw = typeof req.query["backends"] === "string" ? (req.query["backends"] as string) : "";
  const fromQuery = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const source = getSettings().backendSource;
  const backends = fromQuery.length ? fromQuery : source && source !== "all" && source !== "none" ? [source] : [];
  const credentials = requiredCredentials(backends);
  res.json({
    backends,
    credentials,
    templates: {
      env: renderCredentialTemplate(credentials, "env"),
      compose: renderCredentialTemplate(credentials, "compose"),
    },
  });
});

// POST /api/setup/connections/test — ask the broker to verify it can reach a
// backend with its configured credentials. Admin-only.
router.post("/setup/connections/test", requireRole("admin"), async (req, res) => {
  const parsed = parseOr400(req, res, CONNECTION_TEST_BODY);
  if (!parsed) return;
  const result = await callBrokerCapability(
    brokerVerifyConnection(contextFromReq(req), parsed.backend),
    res,
    { unsupported: { ok: false, error: "this broker does not support connection tests" }, failed: (m) => ({ ok: false, error: m }) },
  );
  if (result) res.json(result);
});

// POST /api/setup/connections/vault — DELEGATE a vendor credential to the broker's
// own encrypted credential store. The secret is relayed ONCE and never persisted by
// OmniProject (not stored, not logged). 501 when the broker has no vault. Admin-only.
router.post("/setup/connections/vault", requireRole("admin"), requireStepUp, async (req, res) => {
  const parsed = parseOr400(req, res, CONNECTION_VAULT_BODY);
  if (!parsed) return;
  const result = await callBrokerCapability(
    brokerStoreCredential(contextFromReq(req), parsed), // result carries only a non-secret ref
    res,
    {
      unsupported: { stored: false, error: "this broker has no credential vault — use the env/Docker-secret template instead" },
      failed: (m) => ({ stored: false, error: m }),
    },
  );
  if (result) res.json({ stored: result.stored, ref: result.ref ?? null });
});

// POST /api/setup/generate-workflow — emit an importable n8n workflow for the
// chosen backend. Stateless: returned for download, nothing stored. Admin only.
// readOnly (default true) omits every write action, so the quickstart default
// is a workflow that cannot mutate the backend even before anyone reviews it.
router.post("/setup/generate-workflow", requireRole("admin"), (req, res) => {
  const backendId = typeof req.body?.backendId === "string" ? req.body.backendId : "";
  const webhookPath = typeof req.body?.webhookPath === "string" ? req.body.webhookPath : undefined;
  const readOnly = typeof req.body?.readOnly === "boolean" ? req.body.readOnly : true;
  const manifest = getBackend(backendId);
  if (!manifest) {
    res.status(404).json({ error: `Unknown backend: ${backendId}` });
    return;
  }
  // Enterprise backend workflows (SAP, Primavera, Dynamics 365, …) are premium.
  if (isEnterpriseBackend(backendId) && !isEntitled("enterprise_workflows")) {
    res.status(402).json({
      error: `Generating the ${manifest.label} workflow is a licensed enterprise integration. Add a valid LICENSE_KEY with the "enterprise_workflows" feature.`,
      feature: "enterprise_workflows",
      backend: backendId,
      license: resolveLicense(),
    });
    return;
  }
  const workflow = generateWorkflow(manifest, { webhookPath, readOnly });
  res
    .type("application/json")
    .set("Content-Disposition", `attachment; filename="omniproject-${manifest.id}${readOnly ? "-readonly" : ""}.json"`)
    .send(JSON.stringify(workflow, null, 2));
});

// POST /api/setup/verify-workflow — probe the configured broker with verify:true
// for each non-mutating action and report per-action conformance. Admin only.
// The { verify: true } flag lets a generated workflow short-circuit so nothing
// touches the backend; only read/declarative actions are probed regardless.
router.post("/setup/verify-workflow", requireRole("admin"), async (req, res) => {
  const url = (typeof req.body?.webhookUrl === "string" && req.body.webhookUrl.trim()) || getSettings().brokerUrl;
  if (!url || !/^https?:\/\//i.test(url)) {
    res.status(400).json({ error: "No broker webhook configured. Connect the broker first or pass webhookUrl." });
    return;
  }
  try {
    await assertEgressAllowed(url); // SSRF guard: never let an admin-pasted URL reach metadata/link-local
  } catch (err) {
    res.status(400).json({ error: err instanceof EgressError ? err.message : "That webhook URL is not allowed." });
    return;
  }
  const sampleProjectId = typeof req.body?.projectId === "string" ? req.body.projectId : "sample";

  const results = await probeVerifiableActions(url, sampleProjectId);

  const passed = results.filter((r) => r.ok).length;
  res.json({
    webhookUrl: url,
    summary: { passed, total: results.length, verifyAware: results.some((r) => r.verifyAware) },
    results,
    note: "Write actions (create/update/delete) are not probed to avoid mutating your backend. A generated workflow honours { verify: true } so even reads never hit the backend.",
  });
});

export default router;
