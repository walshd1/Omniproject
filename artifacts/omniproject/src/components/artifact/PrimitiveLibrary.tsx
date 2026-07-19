import { useMemo } from "react";
import type { PrimitiveDef } from "../charts/catalogue";
import { PRIMITIVE_LIBRARY } from "../../definitions/primitives";
import { useResolvedDefs } from "../../lib/defs";
import { primitiveTree, primitiveTreeWith, primitiveFromResolved, type Primitive, type ResolvedPrimitive, type PrimitiveFamily, type PrimitiveFamilyTree, type PlacementSurface } from "../../lib/primitive-store";

/** Fetch the customer-ACTIVATED primitives (org/programme/project) resolved from the def store and map them to
 *  palette `Primitive`s. Gated by `enabled` (the palette only asks when it means to fold them in) and scoped to
 *  the caller's project/programme so scope-confined activations appear only where they apply. Returns [] until
 *  loaded, or when the `defImporter` module is off (the route yields an empty set). */
function useActivatedPrimitives(enabled: boolean, projectId?: string, programmeId?: string): Primitive[] {
  const resolved = useResolvedDefs<ResolvedPrimitive["payload"]>("primitive", projectId, programmeId, enabled);
  return useMemo(
    () => (resolved.data ?? []).map((d) => primitiveFromResolved({ id: d.id, payload: d.payload })),
    [resolved.data],
  );
}

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
  block: "Document blocks",
  canvas: "Whiteboard elements",
  annotation: "Proof markers",
  keyResult: "Goal key results",
  invoiceLine: "Invoice lines",
  extensionContribution: "Extension contributions",
  registryItem: "Registry items",
  component: "Reports & widgets",
};

export function PrimitiveLibrary({ onPick, surface, tree, includeActivated = false, projectId, programmeId, testId = "primitive-library" }: {
  onPick?: (primitive: Primitive) => void;
  surface?: PlacementSurface;
  tree?: PrimitiveFamilyTree[];
  /** Also fold in customer-ACTIVATED primitives (org-authored + `blank`-derived families) from the def store,
   *  so the builder palette shows what an org has activated, not only the shipped vocabulary. */
  includeActivated?: boolean;
  projectId?: string;
  programmeId?: string;
  testId?: string;
}) {
  // An explicit `tree` prop wins (the caller pre-computed the palette). Otherwise, when asked to include the
  // customer-activated primitives, delegate to the fetching variant (which mounts the def-store query); when not,
  // render the static store directly. Splitting the fetch into its own component keeps the plain palette free of
  // any React Query dependency (a bare `<PrimitiveLibrary />` never touches the network).
  if (!tree && includeActivated) {
    return <ActivatedPrimitiveLibrary {...{ onPick, surface, projectId, programmeId, testId }} />;
  }
  return <PrimitiveLibraryView families={tree ?? primitiveTree(surface)} onPick={onPick} testId={testId} />;
}

/** The `includeActivated` variant: fetch the activated primitives from the def store, fold them into the tree,
 *  then render the shared view. Isolated so the def-store query only mounts when the caller opts in. */
function ActivatedPrimitiveLibrary({ onPick, surface, projectId, programmeId, testId }: {
  onPick?: ((primitive: Primitive) => void) | undefined;
  surface?: PlacementSurface | undefined;
  projectId?: string | undefined;
  programmeId?: string | undefined;
  testId: string;
}) {
  const activated = useActivatedPrimitives(true, projectId, programmeId);
  const families = useMemo(() => primitiveTreeWith(activated, surface), [activated, surface]);
  return <PrimitiveLibraryView families={families} onPick={onPick} testId={testId} />;
}

/** The presentational palette — grouped family → category subfolder, each entry tagged, viz entries enriched
 *  with their chart-catalogue detail. Pure: it renders whatever tree it's handed. */
export function PrimitiveLibraryView({ families, onPick, testId = "primitive-library" }: {
  families: PrimitiveFamilyTree[];
  onPick?: ((primitive: Primitive) => void) | undefined;
  testId?: string | undefined;
}) {
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
