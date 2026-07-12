import { type PrimitiveCategory, type PrimitiveDef } from "../charts/catalogue";
import { PRIMITIVE_LIBRARY } from "../../definitions/primitives";

/**
 * PrimitiveLibrary — a browsable palette of every rendering primitive available, rendered straight off
 * the resolved library (the shipped code catalogue plus any drop-in primitive JSON). It's the visible
 * "library of primitives users can build their own charts from": each entry shows what it draws, the data
 * it needs and the options it takes. Read-only reference; an optional `onPick` lets a builder use it as an
 * insert palette. Pass `primitives` to render a specific set.
 */
const CATEGORY_LABEL: Record<PrimitiveCategory, string> = {
  chart: "Charts",
  graphic: "Graphics",
  table: "Tables",
  tile: "Tiles",
};

const CATEGORY_ORDER: PrimitiveCategory[] = ["chart", "graphic", "table", "tile"];

export function PrimitiveLibrary({ onPick, primitives = PRIMITIVE_LIBRARY, testId = "primitive-library" }: {
  onPick?: (primitive: PrimitiveDef) => void;
  primitives?: PrimitiveDef[];
  testId?: string;
}) {
  return (
    <div className="space-y-4" data-testid={testId}>
      {CATEGORY_ORDER.map((category) => {
        const items = primitives.filter((p) => p.category === category);
        if (items.length === 0) return null;
        return (
          <section key={category} data-testid={`${testId}-${category}`}>
            <h4 className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">{CATEGORY_LABEL[category]}</h4>
            <div className="grid gap-2 sm:grid-cols-2">
              {items.map((p) => (
                <article key={p.id} className="border border-border rounded-md p-2 text-xs" data-testid={`${testId}-item-${p.id}`}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-black">{p.label}</span>
                    {onPick && (
                      <button type="button" className="text-[10px] font-black uppercase tracking-wide underline text-muted-foreground hover:text-foreground"
                        onClick={() => onPick(p)} data-testid={`${testId}-pick-${p.id}`}>Use</button>
                    )}
                  </div>
                  <p className="text-muted-foreground mt-0.5">{p.description}</p>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    <span className="uppercase tracking-widest">Inputs</span>{" "}
                    {p.params.filter((param) => param.required).map((param) => param.label).join(", ") || "none"}
                  </p>
                </article>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
