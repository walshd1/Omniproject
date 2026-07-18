import { Router } from "express";
import { requireRole } from "../lib/rbac";
import { requireArtifactStore } from "../lib/artifact-store";
import { resolveErrorTelemetry, ERROR_TELEMETRY_CONFIG_ID } from "../lib/scoped-config";
import { applyConfigCollectionGuarded } from "../lib/config-guard";
import { captureVersion } from "../lib/config-store";
import { getSession } from "./auth";

/**
 * ERROR TELEMETRY — the admin opt-in for internal client-error reporting (Settings → Diagnostics). It moved out
 * of `SettingsState` into the composition model as a config-def-backed boolean (`error-telemetry`), resolved
 * org def → `ERROR_TELEMETRY` env default → false. It is SECURITY-classified (§0): turning it ON is a relaxation,
 * so the write goes through the floor gate (`config-guard`) — a bound dual-control chain or the solo confirm+sign
 * holds it for a signed sign-off; turning it OFF strengthens and applies immediately.
 *
 *  - GET /api/error-telemetry — the current resolved value (any authed session; the ErrorBoundary sync reads it).
 *  - PUT /api/error-telemetry — set it (admin). Body: `{ errorTelemetry: boolean }`; enabling → 202 pending.
 */
const router = Router();

router.get("/error-telemetry", (_req, res) => {
  res.json({ errorTelemetry: resolveErrorTelemetry() });
});

router.put("/error-telemetry", requireRole("admin"), async (req, res) => {
  if (!requireArtifactStore(res)) return;
  const value = (req.body as { errorTelemetry?: unknown } | undefined)?.errorTelemetry;
  if (typeof value !== "boolean") { res.status(400).json({ error: "errorTelemetry must be a boolean" }); return; }
  const guarded = await applyConfigCollectionGuarded(ERROR_TELEMETRY_CONFIG_ID, "Error telemetry", value, getSession(req)?.sub ?? "admin");
  if (!guarded.applied) {
    res.status(202).json({ pending: guarded.pending, message: "This change reduces the security posture and needs a signed sign-off before it applies. See /api/approvals/inbox." });
    return;
  }
  captureVersion("error telemetry updated");
  res.json({ errorTelemetry: resolveErrorTelemetry() });
});

export default router;
