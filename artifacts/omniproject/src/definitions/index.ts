import { parseBuiltinArtifacts, type BuiltinArtifactDef } from "./builtin-defs";

/**
 * The shipped baseline artifact set, enumerated from the JSON files under `builtin/artifacts/` at build
 * time. `import.meta.glob` with `eager` + `import: "default"` makes every `.json` in the folder a member
 * — drop a new file in and it appears here, no registration. Loaded statelessly; never persisted.
 */
const modules = import.meta.glob("./builtin/artifacts/*.json", { eager: true, import: "default" }) as Record<string, unknown>;

export const BUILTIN_ARTIFACTS: BuiltinArtifactDef[] = parseBuiltinArtifacts(modules);

export type { BuiltinArtifactDef, BuiltinArtifactKind } from "./builtin-defs";
export { parseBuiltinArtifacts } from "./builtin-defs";
