/**
 * PORTAL module — the client/guest portal landing (scoped guest tier, magic-link entry). Self-contained
 * page slice; exposed through this barrel. Note: the portal DATA layer (lib/portal) stays in the shared
 * core because the settings guest-invite panel also depends on it — only the page lives here. The `defs/`
 * folder holds this module's JSON definitions (see defs/README.md).
 */
export { Portal } from "./Portal";
