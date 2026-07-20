import { Router, type RequestHandler } from "express";
import { getSettings, SettingsValidationError, type SettingsState } from "./settings";
import { captureVersion } from "./config-store";
import { applySettingsGuarded } from "./settings-guard";
import { actorForAudit } from "./audit";
import { readConfigCollection, writeOrgConfigCollection } from "./scoped-config";

/**
 * Factory for the recurring "settings collection" route shape: a GET that reads one
 * `SettingsState` field and a write (PUT/PATCH) that persists it, wrapped in the standard
 * `SettingsValidationError → 400` catch and a config-version capture. Every saved-view /
 * dashboard / custom-report / content-page / report-override / priority-weights endpoint is an
 * instance of exactly this shape — they differed only in the field name, response key, version
 * label and (optionally) an authoring role. See routes/views.ts et al.
 *
 * Validation and the actual persistence contract stay entirely in `updateSettings`; this only
 * removes the boilerplate wrapper that every route re-inlined byte-for-byte.
 */
export interface SettingsCollectionOptions {
  /** Route path, e.g. `/views` or `/reports/custom`. */
  path: string;
  /** The `SettingsState` field this collection reads and writes. Omitted in `configId` (config-def) mode,
   *  where the collection has left settings — pass `responseKey` there instead. */
  settingsKey?: keyof SettingsState;
  /** The JSON property on both the request body and the reply. Defaults to `settingsKey`;
   *  set it only where the two differ (savedViews is exposed as `views`) or in config-def mode (required). */
  responseKey?: string;
  /** `captureVersion` label recorded on a successful write. */
  versionLabel: string;
  /** GET fallback when the field is unset. Defaults to `[]` (every collection but the
   *  priority-weights object, which passes its own default). */
  default?: unknown;
  /** Extra middleware guarding the WRITE only (e.g. `[requireRole("pmo")]`). */
  writeGuards?: RequestHandler[];
  /** Extra middleware guarding the READ. Usually empty — most of these collections are shared,
   *  benign presentation config with an open GET — but the availability-curation pair guards its
   *  GET (admin/PMO), so the factory has to be able to express that too. */
  readGuards?: RequestHandler[];
  /** Write verb — `put` (default) or `patch` (the availability-curation pair). */
  method?: "put" | "patch";
  /**
   * Opt-in: persist to a scope-layered `config` DEF (org scope) with this logical id, INSTEAD of a
   * `SettingsState` key — the settings→composition-model migration. The collection leaves settings entirely, so
   * `settingsKey` becomes just the response-key hint. CHOICE collections ONLY: config-def mode does NOT run
   * `applySettingsGuarded`, so a security-classified collection (one whose relaxation needs a sign-off) must
   * stay settings-backed until the floor gate is wired onto this path (roadmap Phase C). Requires `validate`.
   */
  configId?: string;
  /** Validator for config-def mode — settings validation lives in `updateSettings`, so off settings we carry
   *  the collection's own sanitiser here. Return the normalised value; throw {@link SettingsValidationError}
   *  (→ 400) on bad input. */
  validate?: (value: unknown) => unknown;
}

/** Build a `Router` exposing the GET + write pair for one settings-collection field. Mountable
 *  standalone (`export default settingsCollectionRouter(...)`) or via `router.use(...)` alongside
 *  other routes on a shared router (the capabilities curation pair). */
export function settingsCollectionRouter(opts: SettingsCollectionOptions): Router {
  const { path, settingsKey, versionLabel, configId, validate } = opts;
  const responseKey = opts.responseKey ?? settingsKey;
  if (!responseKey) throw new Error("settingsCollectionRouter needs settingsKey or responseKey");
  if (!configId && !settingsKey) throw new Error("settingsCollectionRouter needs settingsKey unless configId is set");
  const fallback = opts.default ?? [];
  const router = Router();

  router.get(path, ...(opts.readGuards ?? []), (_req, res) => {
    if (configId) { res.json({ [responseKey]: readConfigCollection(configId, fallback) }); return; }
    res.json({ [responseKey]: getSettings()[settingsKey!] ?? fallback });
  });

  const write: RequestHandler = async (req, res) => {
    const value = (req.body as Record<string, unknown> | undefined)?.[responseKey];
    try {
      // CONFIG-DEF MODE: validate with the carried sanitiser, then persist as the org config def. CHOICE-only
      // (no security sign-off gate on this path yet — see the `configId` doc), so no `applySettingsGuarded`.
      if (configId) {
        const normalised = validate ? validate(value) : value;
        writeOrgConfigCollection(configId, versionLabel, normalised);
        captureVersion(versionLabel);
        res.json({ [responseKey]: readConfigCollection(configId, fallback) });
        return;
      }
      // Governing invariant (§0): a write that REDUCES the security posture (e.g. weakening approvalChains)
      // is held for a signed sign-off; a choice/strengthening write applies immediately. Most collections
      // are choices, so this is a no-op for them.
      const guarded = await applySettingsGuarded({ [settingsKey!]: value } as Partial<SettingsState>, actorForAudit(req)?.sub ?? "admin");
      if (!guarded.applied) {
        res.status(202).json({ pending: guarded.pending, message: "This change reduces the security posture and needs a signed sign-off before it applies. See /api/approvals/inbox." });
        return;
      }
      captureVersion(versionLabel);
      res.json({ [responseKey]: getSettings()[settingsKey!] });
    } catch (err) {
      if (err instanceof SettingsValidationError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  };

  const handlers = [...(opts.writeGuards ?? []), write];
  if (opts.method === "patch") router.patch(path, ...handlers);
  else router.put(path, ...handlers);

  return router;
}
