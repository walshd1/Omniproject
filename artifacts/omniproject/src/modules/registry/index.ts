/**
 * REGISTRY module — the org registry of approved bespoke items (submit / browse / admin approval /
 * community release). Self-contained page slice; exposed through this barrel. Note: the registry DATA
 * layer (lib/registry) stays in the shared core because the screen renderer depends on it — only the
 * page lives here. The `defs/` folder holds this module's JSON definitions (see defs/README.md).
 */
export { Registry } from "./Registry";
