/**
 * PLUGIN MARKETPLACE model — the neutral, primitive-built shape for OmniProject's installable extensions
 * (roadmap 3.4). Same architectural principle as goals (key-result primitives) and invoices (line primitives):
 * an EXTENSION is a JSON manifest carrying a list of typed CONTRIBUTION PRIMITIVES, each a pure-JSON config
 * artefact the app already understands (a custom report, a content page, a dashboard, a screen) — no new code
 * ships with an extension, so installing one is a governance decision, not a deploy.
 *
 * The single `EXTENSION_CONTRIBUTION_KINDS` list is what the install validator AND the unified primitive
 * store (the `extensionContribution` family, placeable on the `marketplace` surface) draw from, so the store
 * can never drift from what an extension may contribute. The authoritative sanitiser runs server-side.
 */

/**
 * The kinds of thing an extension may contribute — all PURE JSON config the platform already renders:
 * `report` (a custom report def), `contentPage` (a content page), `dashboard` (a dashboard def),
 * `screen` (a screen def). No contribution kind carries executable code.
 */
export type ExtensionContributionKind = "report" | "contentPage" | "dashboard" | "screen";

/** The contribution primitives, as a value — the single list the validator + primitive store draw from. */
export const EXTENSION_CONTRIBUTION_KINDS: readonly ExtensionContributionKind[] = ["report", "contentPage", "dashboard", "screen"];

/** An installed extension's lifecycle. `installed` — active; `disabled` — retained but its contributions
 *  are not surfaced. (Uninstall removes it entirely.) */
export type ExtensionStatus = "installed" | "disabled";
export const EXTENSION_STATUSES: readonly ExtensionStatus[] = ["installed", "disabled"];

/** A human label for a contribution kind (for the marketplace UI). Pure. */
export function contributionKindLabel(kind: ExtensionContributionKind): string {
  switch (kind) {
    case "report": return "Report";
    case "contentPage": return "Content page";
    case "dashboard": return "Dashboard";
    case "screen": return "Screen";
    default: return kind;
  }
}
