import { useMemo } from "react";
import type { PrimitiveDef } from "../charts/catalogue";
import { PRIMITIVE_LIBRARY } from "../../definitions/primitives";
import { primitiveTree, type Primitive, type PrimitiveFamily, type PrimitiveFamilyTree, type PlacementSurface } from "../../lib/primitive-store";

/**
 * PrimitiveLibrary — the browsable palette of EVERY rendering primitive, rendered off the one shared
 * primitive store (`primitiveTree`): grouped family → category subfolder, each entry tagged. It is the
 * visible "library of primitives you can build with"; an optional `onPick` makes it an insert palette, and
 * `surface` scopes it to what's placeable there (e.g. `surface="report"`). Data-visualisation primitives are
 * enriched with their chart-catalogue detail (what they draw + required inputs) since that metadata exists.
 */
const FAMILY_LABEL: Record<PrimitiveFamily, string> = {
  panel: "Panels",
  viz: "Visualisations",
  field: "Form fields",
  component: "Reports & widgets",
};

export function PrimitiveLibrary({ onPick, surface, tree, testId = "primitive-library" }: {
  onPick?: (primitive: Primitive) => void;
  surface?: PlacementSurface;
  tree?: PrimitiveFamilyTree[];
  testId?: string;
}) {
  const families = tree ?? primitiveTree(surface);
  // Viz detail (description + required inputs) by id — the extra metadata only viz primitives carry.
  const vizDetail = useMemo(() => new Map<string, PrimitiveDef>(PRIMITIVE_LIBRARY.map((p) => [p.id, p])), []);

  return (
    <div className="space-y-6" data-testid={testId}>
      {families.map((fam) => (
        <section key={fam.family} data-testid={`${testId}-family-${fam.family}`}>
          <h3 className="text-xs font-black uppercase tracking-widest mb-2">{FAMILY_LABEL[fam.family]}</h3>
          <div className="space-y-3">
            {fam.folders.map((folder) => (
              <div key={`${fam.family}-${folder.category}`} data-testid={`${testId}-${folder.category}`}>
                <h4 className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">{folder.category}</h4>
                <div className="grid gap-2 sm:grid-cols-2">
                  {folder.primitives.map((p) => {
                    const detail = fam.family === "viz" ? vizDetail.get(p.id) : undefined;
                    return (
                      <article key={p.id} className="border border-border rounded-md p-2 text-xs" data-testid={`${testId}-item-${p.family}-${p.id}`}>
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="font-black">{p.label}</span>
                          {onPick && (
                            <button type="button" className="text-[10px] font-black uppercase tracking-wide underline text-muted-foreground hover:text-foreground"
                              onClick={() => onPick(p)} data-testid={`${testId}-pick-${p.family}-${p.id}`}>Use</button>
                          )}
                        </div>
                        {detail?.description && <p className="text-muted-foreground mt-0.5">{detail.description}</p>}
                        {detail && (
                          <p className="mt-1 text-[10px] text-muted-foreground">
                            <span className="uppercase tracking-widest">Inputs</span>{" "}
                            {detail.params.filter((param) => param.required).map((param) => param.label).join(", ") || "none"}
                          </p>
                        )}
                        {p.tags.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1" data-testid={`${testId}-tags-${p.family}-${p.id}`}>
                            {p.tags.map((t) => <span key={t} className="rounded bg-muted px-1 text-[10px] text-muted-foreground">{t}</span>)}
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
