import { describe, it, expect } from "vitest";
import { PRIMITIVE_CATALOGUE } from "./catalogue";
import {
  PRIMITIVE_PARAM_TYPES, PRIMITIVE_CATEGORIES, CHART_VIEW_TYPES, validatePrimitiveDef,
} from "@workspace/backend-catalogue";

/**
 * DRIFT GUARD — the shipped chart primitive catalogue (the runtime rendering side) must only ever use the
 * closed sets defined in `@workspace/backend-catalogue/primitive-schema` (the shared validation side). If a
 * new primitive introduces a param type / category / chart type not in the shared schema, this fails and the
 * schema (+ the AI authoring validator) must be updated in lockstep — so the two can never silently diverge.
 */
describe("primitive catalogue ↔ shared schema", () => {
  it("every catalogue primitive validates against the shared schema", () => {
    for (const p of PRIMITIVE_CATALOGUE) {
      const r = validatePrimitiveDef(p);
      expect(r.ok, `${p.id}: ${r.errors.join(" | ")}`).toBe(true);
    }
  });

  it("every category / param type / chart type used is in the shared closed sets", () => {
    const categories = new Set(PRIMITIVE_CATALOGUE.map((p) => p.category));
    for (const c of categories) expect(PRIMITIVE_CATEGORIES).toContain(c);

    const paramTypes = new Set(PRIMITIVE_CATALOGUE.flatMap((p) => p.params.map((x) => x.type)));
    for (const t of paramTypes) expect(PRIMITIVE_PARAM_TYPES).toContain(t);

    const chartTypes = new Set(PRIMITIVE_CATALOGUE.map((p) => p.chartType).filter(Boolean) as string[]);
    for (const t of chartTypes) expect(CHART_VIEW_TYPES).toContain(t);
  });
});
