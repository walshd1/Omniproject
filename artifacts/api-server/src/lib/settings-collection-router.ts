import { Router, type RequestHandler } from "express";
import { getSettings, SettingsValidationError, type SettingsState } from "./settings";
import { captureVersion } from "./config-store";
import { applySettingsGuarded } from "./settings-guard";
import { actorForAudit } from "./audit";
import { readConfigCollection, writeOrgConfigCollection } from "./scoped-config";
import { isSecurityConfig } from "./security-config";
import { applyConfigCollectionGuarded } from "./config-guard";
import { filterRowsByProjectScope, mergeRowsByProjectScope } from "./project-scope";

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
   * `settingsKey` becomes just the response-key hint. A CHOICE config writes immediately; a config registered in
   * `SECURITY_CONFIGS` is guarded by the floor gate — a relaxation is held for a signed sign-off (§0), exactly as
   * `applySettingsGuarded` guards a settings key. Requires `validate`.
   */
  configId?: string;
  /** Validator for config-def mode — settings validation lives in `updateSettings`, so off settings we carry
   *  the collection's own sanitiser here. Return the normalised value; throw {@link SettingsValidationError}
   *  (→ 400) on bad input. */
  validate?: (value: unknown) => unknown;
  /** OPT-IN data-seam scoping for collections whose rows are per-PROJECT data (resource allocations,
   *  budget plans) rather than global presentation config. When set, `scopeByProject` extracts a row's owning
   *  project id, and the router: (a) returns only in-scope rows on GET, and (b) on write, lets a scoped
   *  caller add/replace/remove ONLY their in-scope rows while preserving every out-of-scope row (a submitted
   *  out-of-scope row is a 403). Omitted ⇒ the collection is global config (unchanged behaviour). */
  scopeByProject?: (row: unknown) => string | null | undefined;
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

  router.get(path, ...(opts.readGuards ?? []), async (req, res) => {
    const rows = configId ? readConfigCollection(configId, fallback) : (getSettings()[settingsKey!] ?? fallback);
    // Per-project collections only expose the caller's in-scope rows; global config is returned as-is.
    const out = opts.scopeByProject && Array.isArray(rows)
      ? await filterRowsByProjectScope(req, rows as unknown[], opts.scopeByProject)
      : rows;
    res.json({ [responseKey]: out });
  });

  const write: RequestHandler = async (req, res) => {
    let value = (req.body as Record<string, unknown> | undefined)?.[responseKey];
    // Data-seam enforcement for per-project collections: a scoped caller may only touch their in-scope
    // rows; out-of-scope rows are preserved, and a submitted out-of-scope row is refused. Runs BEFORE the
    // security-guard/persist so the merged (safe) value is what gets validated and stored.
    if (opts.scopeByProject) {
      if (!Array.isArray(value)) { res.status(400).json({ error: `${responseKey} must be an array` }); return; }
      const existing = settingsKey ? getSettings()[settingsKey] : [];
      const merge = await mergeRowsByProjectScope(req, Array.isArray(existing) ? existing as unknown[] : [], value as unknown[], opts.scopeByProject);
      if ("forbidden" in merge) { res.status(403).json({ error: merge.forbidden }); return; }
      value = merge.merged;
    }
    try {
      // CONFIG-DEF MODE: validate with the carried sanitiser, then persist as the org config def. A CHOICE
      // config writes immediately; a SECURITY-classified config (registered in `SECURITY_CONFIGS`) goes through
      // the floor gate — a relaxation is held for a signed sign-off, exactly as `applySettingsGuarded` does for
      // a settings key. The gate reads the current resolved value itself, so it's the same governing invariant.
      if (configId) {
        const normalised = validate ? validate(value) : value;
        if (isSecurityConfig(configId)) {
          const guarded = await applyConfigCollectionGuarded(configId, versionLabel, normalised, actorForAudit(req)?.sub ?? "admin");
          if (!guarded.applied) {
            res.status(202).json({ pending: guarded.pending, message: "This change reduces the security posture and needs a signed sign-off before it applies. See /api/approvals/inbox." });
            return;
          }
        } else {
          writeOrgConfigCollection(configId, versionLabel, normalised);
        }
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
