/*
 * SPDX-License-Identifier: LicenseRef-OmniProject-Premium
 * Premium feature — governed by LICENSE-PREMIUM.txt, NOT Apache-2.0.
 * Use in production requires a valid OmniProject commercial licence.
 */
import { getSettings, updateSettings } from "./settings";
import { isEntitled } from "./license";

/**
 * Field / term label overrides (premium feature `labels`).
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

/** The label overrides the UI should apply right now ({} unless entitled). */
export function effectiveLabels(): { entitled: boolean; locked: boolean; overrides: Record<string, string>; catalog: LabelTerm[] } {
  const entitled = isEntitled("labels");
  const stored = getSettings().labelOverrides ?? {};
  const hasOverride = Object.keys(stored).length > 0;
  return {
    entitled,
    locked: hasOverride && !entitled,
    overrides: entitled ? stored : {},
    catalog: LABEL_CATALOG,
  };
}

/** Persist label overrides (callers must enforce the entitlement). */
export function saveLabels(input: unknown): Record<string, string> {
  const overrides = sanitizeLabels(input);
  updateSettings({ labelOverrides: overrides });
  return overrides;
}