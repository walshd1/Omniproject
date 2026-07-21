/**
 * DEFINITIONS module — the def editor / importer admin surface (browse, edit, import, and bind JSON
 * definitions with scope-aware permissions). Self-contained page slice; exposed through this barrel.
 * Note: the def DATA + policy layers (lib/defs, lib/def-policy) and the shared def components
 * (components/defs) stay in the core — the whole app renders from them — so only the page lives here.
 * The `defs/` folder holds this module's own JSON definitions (see defs/README.md).
 */
export { Definitions } from "./Definitions";
