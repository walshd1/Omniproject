import { primitiveCatalogue } from "./primitive-catalogue";
import { reportCatalogue } from "./report-catalogue";
import { screenDefCatalogue } from "./screen-def-catalogue";
import { mappingCatalogue } from "./mapping-catalogue";

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
    default: return [];
  }
}
