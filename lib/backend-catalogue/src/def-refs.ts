import { primitiveCatalogue } from "./primitive-catalogue";
import { reportCatalogue } from "./report-catalogue";
import { screenDefCatalogue } from "./screen-def-catalogue";
import { mappingCatalogue } from "./mapping-catalogue";
import { formCatalogue } from "./form-catalogue";
import { dashboardDefCatalogue } from "./dashboard-preset-catalogue";
import { referenceRulesetCatalogue } from "./methodology-rulesets";
import { methodologyCatalogue } from "./methodology-catalogue";

/**
 * Composition ancestry refs — the shipped `{ id, extends }` of every def of a kind, so the importer can verify a
 * newly-imported def's `extends` parent EXISTS and the chain doesn't cycle (a "broken ancestor" check) against
 * the shipped catalogue plus the scoped def store. Only id + parent are exposed; the full defs stay where they
 * are. Kinds that ship no catalogue (theme/font/…) return [].
 */
export interface DefRef { id: string; extends?: string }

const ref = (d: { id: string; extends?: string }): DefRef => (d.extends ? { id: d.id, extends: d.extends } : { id: d.id });

export function shippedDefRefs(kind: string): DefRef[] {
  switch (kind) {
    case "primitive": return primitiveCatalogue().map(ref);
    case "report": return reportCatalogue().map(ref);
    case "screen": return screenDefCatalogue().map((s) => ref({ id: s.id, ...(typeof s["extends"] === "string" ? { extends: s["extends"] as string } : {}) }));
    case "mapping": return mappingCatalogue().map((m) => ref({ id: m.id }));
    case "form": return formCatalogue().map(ref);
    case "dashboard": return dashboardDefCatalogue().map(ref);
    case "businessRule": return referenceRulesetCatalogue().map(ref);
    case "methodology": return methodologyCatalogue().map(ref);
    default: return [];
  }
}

/**
 * The full shipped def PAYLOADS of a kind. The importer's integrity check composes a user def over these to
 * validate the WHOLE, so it needs the fields, not just the ids. `extends` edges are kept intact — a shipped
 * child (e.g. the `register` primitive) and its shipped parent (`table`) are BOTH returned, so the importer's
 * graph reflects the real ancestry rather than treating children as pre-flattened roots.
 */
export function shippedDefs(kind: string): Record<string, unknown>[] {
  switch (kind) {
    case "primitive": return primitiveCatalogue() as unknown as Record<string, unknown>[];
    case "report": return reportCatalogue() as unknown as Record<string, unknown>[];
    case "screen": return screenDefCatalogue() as unknown as Record<string, unknown>[];
    case "mapping": return mappingCatalogue() as unknown as Record<string, unknown>[];
    case "form": return formCatalogue() as unknown as Record<string, unknown>[];
    case "dashboard": return dashboardDefCatalogue() as unknown as Record<string, unknown>[];
    case "businessRule": return referenceRulesetCatalogue() as unknown as Record<string, unknown>[];
    case "methodology": return methodologyCatalogue() as unknown as Record<string, unknown>[];
    default: return [];
  }
}
