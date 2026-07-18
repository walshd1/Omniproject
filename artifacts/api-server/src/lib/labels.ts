/*
 * SPDX-License-Identifier: LicenseRef-OmniProject-Premium
 * Premium feature — governed by licenses/PREMIUM.txt, NOT Apache-2.0.
 * Use in production requires a valid OmniProject commercial licence.
 */
import { isEntitled } from "./license";
import { logger } from "./logger";
import { artifactStoreEnabled, makeScopedId } from "./artifact-store";
import { getDef, putDef, type StoredDef } from "./def-import";

/**
 * Field / term label overrides (historically the premium `labels` feature).
 *
 * Companies use their own nomenclature — "Engagements" instead of "Projects",
 * "Portfolios" instead of "Programmes", "Tickets" instead of "Issues". This lets
 * an operator remap the high-traffic UI terms without a fork. Overrides are
 * keyed by the same i18n keys the SPA renders, so they layer cleanly over the
 * localized dictionaries (an override wins in every locale).
 *
 * Only a curated allow-list of keys may be overridden, so a typo can't inject
 * arbitrary copy. Stateless: kept in the settings store, included in snapshots.
 */

export interface LabelTerm {
  key: string;
  /** The product default (English), shown as placeholder in the editor. */
  default: string;
}

// Curated, overridable terms — the nouns companies most often rename.
export const LABEL_CATALOG: LabelTerm[] = [
  { key: "nav.dashboard", default: "Dashboard" },
  { key: "nav.programmes", default: "Programmes" },
  { key: "nav.projects", default: "Projects" },
  { key: "nav.reports", default: "Reports" },
  { key: "term.programme", default: "Programme" },
  { key: "term.project", default: "Project" },
  { key: "term.issue", default: "Issue" },
  { key: "term.issues", default: "Issues" },
  { key: "term.task", default: "Task" },
  { key: "term.tasks", default: "Tasks" },
  { key: "term.portfolio", default: "Portfolio" },
  { key: "term.member", default: "Member" },
  { key: "term.milestone", default: "Milestone" },
  { key: "reports.portfolioHealth", default: "Portfolio Health" },
];

const ALLOWED = new Set(LABEL_CATALOG.map((t) => t.key));
const MAX_LEN = 60;

// STORAGE: label overrides are a `label-overrides` config def at ORG scope (NOT a settings key) — riding the
// sealed def store + the def backup. Beneath the org override sits the DEPLOY DEFAULT from the LABEL_OVERRIDES
// env var (a first-class deploy-time source), then the product defaults.
const LABELS_CONFIG_ID = "label-overrides";
const ORG_LABELS_ID = makeScopedId("org", `config-${LABELS_CONFIG_ID}`);

/** The deploy-time label overrides from the LABEL_OVERRIDES env var (JSON map; {} when unset/invalid). */
export function labelsFromEnv(): Record<string, string> {
  const raw = process.env["LABEL_OVERRIDES"]?.trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) if (typeof v === "string") out[k] = v;
    return out;
  } catch (err) {
    logger.warn({ err }, "LABEL_OVERRIDES is not valid JSON — ignoring, no label overrides seeded");
    return {};
  }
}

/** The stored org label overrides (the config def's values), or null when unset / no store. Sanitised on READ
 *  through the SAME guard as `saveLabels` (catalogue allow-list + length cap + string-only), so a non-catalogue
 *  key or oversized value that entered via a restored/tampered BACKUP (the generic config-def importer has no
 *  labels validator) is normalised before use rather than rendered. */
function orgLabels(): Record<string, string> | null {
  if (!artifactStoreEnabled()) return null;
  const v = (getDef({ kind: "org" }, ORG_LABELS_ID)?.payload as { values?: unknown } | undefined)?.values;
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  try { return sanitizeLabels(v); } catch { return {}; }
}

/** Validate + normalise an overrides map. Throws on bad input; drops unknowns. */
export function sanitizeLabels(input: unknown): Record<string, string> {
  if (!input || typeof input !== "object") throw new Error("labels must be an object");
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (!ALLOWED.has(k)) continue; // ignore keys outside the catalogue
    if (v === undefined || v === null || v === "") continue; // empty = use default
    if (typeof v !== "string") throw new Error(`label "${k}" must be a string`);
    const trimmed = v.trim();
    if (trimmed.length > MAX_LEN) throw new Error(`label "${k}" is too long (max ${MAX_LEN})`);
    if (trimmed) out[k] = trimmed;
  }
  return out;
}

/**
 * Premium entitlement gate for company nomenclature — DISABLED, not removed.
 *
 * Product decision: nomenclature is a standard PMO/admin governance knob, so the `labels` premium
 * gate is switched off — stored overrides always take effect and any PMO/admin can edit them. The
 * entitlement scaffolding (the `labels` licence feature, `isEntitled`, the lock code path below) is
 * deliberately retained so the gate can be re-enabled by flipping this single flag back to `true`.
 */
const LABELS_PREMIUM_GATE = false;

/** The label overrides the UI should apply right now. With the premium gate disabled (the default)
 *  overrides always apply and `entitled`/`locked` report on/unlocked. If the gate is re-enabled, an
 *  unlicensed instance under premium enforcement is locked and its overrides are withheld. */
export function effectiveLabels(): { entitled: boolean; locked: boolean; overrides: Record<string, string>; catalog: LabelTerm[] } {
  const locked = LABELS_PREMIUM_GATE && !isEntitled("labels");
  return {
    entitled: !locked,
    locked,
    overrides: locked ? {} : (orgLabels() ?? labelsFromEnv()),
    catalog: LABEL_CATALOG,
  };
}

/** Persist label overrides as the org `label-overrides` config def (callers enforce the PMO/admin role). */
export function saveLabels(input: unknown): Record<string, string> {
  const overrides = sanitizeLabels(input);
  const payload = { id: LABELS_CONFIG_ID, values: overrides };
  const existing = getDef({ kind: "org" }, ORG_LABELS_ID);
  const now = new Date().toISOString();
  const row: StoredDef = existing
    ? { ...existing, payload, updatedAt: now, rowVersion: (existing.rowVersion ?? 1) + 1 }
    : { id: ORG_LABELS_ID, kind: "config", name: "Label overrides", payload, createdBy: null, createdAt: now, updatedAt: now, rowVersion: 1 };
  putDef({ kind: "org" }, row);
  return overrides;
}