/**
 * WIKI module — collaborative docs/wiki (page tree, block editor, version history + diff, presence &
 * comments). Self-contained slice: the Wiki page, its Doc components (editor / renderer / history), and
 * its data + diff libs live here, exposed through this barrel. Shared collaborative-editing infra
 * (lib/collab CRDT, presence, PrimitiveLibrary) stays in the core. The `defs/` folder holds this
 * module's JSON definitions (see defs/README.md).
 */
export { Wiki } from "./Wiki";
export { DocEditor } from "./DocEditor";
export { DocHistory } from "./DocHistory";
export { DocRenderer } from "./DocRenderer";
export * from "./wiki";
export * from "./wiki-diff";
