/**
 * SETTINGS module — the settings/admin hub page. Self-contained page slice; exposed through this barrel.
 * Note: the large components/settings/* admin-panel cluster and the settings libs (settings-panels,
 * settings-presets, settings-query, setting-locks) intentionally stay in the shared core — the
 * Configurator and several guards render from them too — so only the hub page lives here. The `defs/`
 * folder holds this module's own JSON definitions (see defs/README.md).
 */
export { Settings } from "./Settings";
