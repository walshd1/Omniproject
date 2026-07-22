/**
 * INVOICING module — live time tracking + invoice generation. Self-contained slice: the Invoices page,
 * the header TimerWidget, and their data hooks (invoices, live-timer) live here. The app touches the page
 * through this barrel; the layout mounts TimerWidget directly. The `defs/` folder holds this module's JSON
 * definitions (see defs/README.md).
 */
export { Invoices } from "./Invoices";
export { TimerWidget } from "./TimerWidget";
export * from "./invoices";
export * from "./live-timer";
