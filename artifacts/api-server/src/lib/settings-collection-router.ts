import { Router, type RequestHandler } from "express";
import { getSettings, updateSettings, SettingsValidationError, type SettingsState } from "./settings";
import { captureVersion } from "./config-store";

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
  /** The `SettingsState` field this collection reads and writes. */
  settingsKey: keyof SettingsState;
  /** The JSON property on both the request body and the reply. Defaults to `settingsKey`;
   *  set it only where the two differ (savedViews is exposed as `views`). */
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
}

/** Build a `Router` exposing the GET + write pair for one settings-collection field. Mountable
 *  standalone (`export default settingsCollectionRouter(...)`) or via `router.use(...)` alongside
 *  other routes on a shared router (the capabilities curation pair). */
export function settingsCollectionRouter(opts: SettingsCollectionOptions): Router {
  const { path, settingsKey, versionLabel } = opts;
  const responseKey = opts.responseKey ?? settingsKey;
  const fallback = opts.default ?? [];
  const router = Router();

  router.get(path, ...(opts.readGuards ?? []), (_req, res) => {
    res.json({ [responseKey]: getSettings()[settingsKey] ?? fallback });
  });

  const write: RequestHandler = (req, res) => {
    const value = (req.body as Record<string, unknown> | undefined)?.[responseKey];
    try {
      const settings = updateSettings({ [settingsKey]: value });
      captureVersion(versionLabel);
      res.json({ [responseKey]: settings[settingsKey] });
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
