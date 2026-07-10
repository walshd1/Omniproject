/**
 * SCREEN registry — the SPA views OmniProject ships. Same principle: a neutral
 * manifest (capabilities — route, required role, required backend capability,
 * lineage/export) separate from its tools (the widgets on it), linked.
 *
 * Like reports, a screen's `requiresCapability` links it to the BACKEND plane so a
 * screen only appears when the backend can feed it.
 */
import { isCapabilityMet } from "./compatibility";
import { matchesMethodology } from "./methodology-match";
import { SCREENS_DATA } from "./screens.generated";

export type ScreenKind = "dashboard" | "detail" | "planning" | "report" | "admin";

export interface ScreenCapabilities {
  /** Minimum role to see it (RBAC — the hard gate still enforces this). */
  requiresRole: "viewer" | "contributor" | "manager" | "admin";
  /** Backend capability the screen needs (or null = always). */
  requiresCapability: string | null;
  /** Carries the per-screen data-lineage overlay? */
  dataLineage: boolean;
  /** Offers CSV/JSON export of what it shows? */
  exportable: boolean;
}

export interface ScreenManifest {
  id: string;
  label: string;
  route: string;
  kind: ScreenKind;
  capabilities: ScreenCapabilities;
  notes?: string;
}

export interface ScreenDefinition extends ScreenManifest {
  /** The widgets / panels on the screen. */
  tools: string[];
  /** Methodology tags — "*"/omitted = neutral (all). */
  methodologies?: string[];
  /** Display order. */
  order: number;
}

/** Every shipped screen, in display order. Authored as JSON under
 *  assets/screens/<id>.json and embedded by gen-screens (drift-guarded in CI). */
export const SCREENS: ScreenDefinition[] = [...SCREENS_DATA].sort((a, b) => a.order - b.order);

/** One screen definition by id, or undefined. */
export function getScreen(id: string): ScreenDefinition | undefined {
  return SCREENS.find((s) => s.id === id);
}

/** All screen definitions (a defensive copy). */
export function screenCatalogue(): ScreenDefinition[] {
  return SCREENS.map((s) => ({ ...s }));
}

/**
 * The HARD capability rule for screens: a screen is AVAILABLE only if at least one
 * connected backend supports the capability it needs (or it needs none). `caps` is
 * the RESOLVED (unioned-across-backends) capability set. Role gating (`requiresRole`)
 * is a SEPARATE, RBAC concern — apply it on top; this gate is purely "can the
 * connected backend(s) feed this screen at all?".
 */
export function availableScreens(caps: Record<string, boolean>): ScreenDefinition[] {
  return screenCatalogue().filter((s) => isCapabilityMet(s.capabilities.requiresCapability, caps));
}

/** Screens tagged with a methodology — those carrying its tag, plus the neutral
 *  ("*"/untagged) ones. The screen-plane analogue of `viewsForMethodology`. */
export function screensForMethodology(methodology: string): ScreenDefinition[] {
  return SCREENS.filter((s) => matchesMethodology(s.methodologies, methodology));
}
