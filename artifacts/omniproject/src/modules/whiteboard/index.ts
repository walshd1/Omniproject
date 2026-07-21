/**
 * WHITEBOARD module — the visual canvas (native SVG editor, live cursors, SVG/PNG export, sticky→work
 * item). Self-contained slice: the Whiteboards page, its Canvas components (editor / renderer), and its
 * data + cursors + export libs live here, exposed through this barrel. Shared geometry-atom infra
 * (lib/canvas-geometry) stays in the core. The `defs/` folder holds this module's JSON definitions
 * (see defs/README.md).
 */
export { Whiteboards } from "./Whiteboards";
export { CanvasEditor, type CanvasEditorHandle } from "./CanvasEditor";
export { CanvasElements } from "./CanvasRenderer";
export * from "./whiteboard";
export * from "./whiteboard-cursors";
export * from "./whiteboard-export";
