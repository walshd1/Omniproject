import { PRIMITIVE_CATALOGUE, type PrimitiveDef } from "../components/charts/catalogue";
import { parseBuiltinPrimitives, mergePrimitives } from "./builtin-primitives";

/**
 * The resolved primitive library — the shipped code catalogue merged with any drop-in primitive JSON
 * enumerated from `builtin/primitives/`. Dropping a `.json` file in (e.g. from a methodology pack) adds or
 * refreshes a primitive with no code change; the result is what the builder palette and PrimitiveLibrary
 * render from. Loaded statelessly at build time.
 */
const modules = import.meta.glob("./builtin/primitives/*.json", { eager: true, import: "default" }) as Record<string, unknown>;

export const PRIMITIVE_LIBRARY: PrimitiveDef[] = mergePrimitives(PRIMITIVE_CATALOGUE, parseBuiltinPrimitives(modules));

export { parseBuiltinPrimitives, mergePrimitives } from "./builtin-primitives";
