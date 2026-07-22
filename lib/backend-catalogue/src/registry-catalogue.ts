/**
 * ORG REGISTRY model — the neutral, primitive-built shape for OmniProject's org-wide store of APPROVED
 * bespoke items (templates, reports, plugins, primitives, JSON defs …). Same architectural principle as
 * goals / invoices / the marketplace: a registry item is a JSON definition of a typed REGISTRY-ITEM PRIMITIVE
 * — a reusable, pure-JSON building block the org has curated. Items flow submit → approve → (optionally)
 * release-to-community, so an org builds an internal library first and can later publish selected items to an
 * (as-yet-unbuilt) online marketplace.
 *
 * The single `REGISTRY_ITEM_KINDS` list is what the submit validator AND the unified primitive store (the
 * `registryItem` family, placeable on the `registry` surface) draw from, so the store can never drift from
 * what the registry can hold. The authoritative sanitiser + approval flow run server-side.
 */

/**
 * The kinds of reusable item the org registry holds — all pure-JSON building blocks the platform understands:
 * a `template` (a project/screen template), a `report` (custom report def), a `primitive` (a primitive def),
 * a `plugin` (a marketplace extension manifest), a `screen` / `dashboard` / `form` def, or a generic
 * `jsonDef` (any other config def). None carries executable code.
 */
export type RegistryItemKind = "template" | "report" | "primitive" | "plugin" | "screen" | "dashboard" | "form" | "jsonDef";

/** The registry-item primitives, as a value — the single list the validator + primitive store draw from. */
export const REGISTRY_ITEM_KINDS: readonly RegistryItemKind[] = ["template", "report", "primitive", "plugin", "screen", "dashboard", "form", "jsonDef"];

/** An item's approval state. `draft` — submitted, awaiting review; `approved` — curated + reusable org-wide;
 *  `rejected` — declined. Only an approved item may be released to the community. */
export type RegistryApprovalStatus = "draft" | "approved" | "rejected";
export const REGISTRY_APPROVAL_STATUSES: readonly RegistryApprovalStatus[] = ["draft", "approved", "rejected"];

/** An item's reach. `internal` — this org only; `community` — the admin has released it for the (future)
 *  online marketplace. Release is always an explicit, admin-only opt-in. */
export type RegistryVisibility = "internal" | "community";
export const REGISTRY_VISIBILITIES: readonly RegistryVisibility[] = ["internal", "community"];

/** A human label for a registry item kind (for the registry UI). Pure. */
export function registryItemKindLabel(kind: RegistryItemKind): string {
  switch (kind) {
    case "template": return "Template";
    case "report": return "Report";
    case "primitive": return "Primitive";
    case "plugin": return "Plugin";
    case "screen": return "Screen";
    case "dashboard": return "Dashboard";
    case "form": return "Form";
    case "jsonDef": return "JSON definition";
    default: return kind;
  }
}
