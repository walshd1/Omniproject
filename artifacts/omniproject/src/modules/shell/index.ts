/**
 * SHELL module — the core screen-engine app pages. These aren't independent features; they're the app's
 * primary surfaces, rendered through the JSON screen/render engine and the `component` primitive registry
 * (components/screen/screen-components). They're grouped here as one cohesive shell rather than split into
 * a module each. App.tsx and the screen-component registry lazy-load them; this barrel provides a single
 * named-export surface. The `defs/` folder holds any shell-specific JSON definitions (see defs/README.md).
 */
export { Home } from "./Home";
export { Projects } from "./Projects";
export { ProjectDetail } from "./ProjectDetail";
export { Programmes } from "./Programmes";
export { ProgrammeDetail } from "./ProgrammeDetail";
export { Reports } from "./Reports";
export { Tasks } from "./Tasks";
export { MyWork } from "./MyWork";
export { Explore } from "./Explore";
export { Resources } from "./Resources";
export { Dashboards } from "./Dashboards";
export { ScreenPage } from "./ScreenPage";
