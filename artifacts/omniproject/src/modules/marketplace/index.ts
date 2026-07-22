/**
 * MARKETPLACE module — third-party plugin/extension marketplace (browse installed, admin install from
 * JSON). Self-contained slice: page + data hooks here, exposed through this barrel. The `defs/` folder
 * holds this module's JSON definitions (see defs/README.md).
 */
export { Marketplace } from "./Marketplace";
export * from "./marketplace";
