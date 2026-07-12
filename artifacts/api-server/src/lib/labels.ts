/*
 * SPDX-License-Identifier: LicenseRef-OmniProject-Premium
 * Premium feature — governed by licenses/PREMIUM.txt, NOT Apache-2.0.
 * Use in production requires a valid OmniProject commercial licence.
 */
import { getSettings, updateSettings } from "./settings";
import { isEntitled } from "./license";

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
    overrides: locked ? {} : getSettings().labelOverrides ?? {},
    catalog: LABEL_CATALOG,
  };
}

/** Persist label overrides (callers enforce the PMO/admin role). */
export function saveLabels(input: unknown): Record<string, string> {
  const overrides = sanitizeLabels(input);
  updateSettings({ labelOverrides: overrides });
  return overrides;
}