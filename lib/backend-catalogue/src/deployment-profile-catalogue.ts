import { DEPLOYMENT_PROFILES_DATA } from "./deployment-profiles.generated";
import { defineCatalogue } from "./catalogue-base";

/**
 * DEPLOYMENT-PROFILE catalogue — a deployment's CONTEXT posture. It lets a deployment declare who it is so the
 * gateway's defaults fit (TLS expectation, the no-IdP finding's severity) and carries the per-audience preset
 * shown in the setup picker. Modelled on the deployment-TYPE catalogue: authored as one JSON file per profile
 * under assets/deployment-profiles/<id>.json, validated + embedded by gen-deployment-profiles, drift-guarded in
 * CI. Because it's DATA (not a code constant), a new profile type ships as JSON — no code change.
 *
 * Nothing here weakens a control silently: a profile only states a posture; the actual relaxation is either
 * that stated posture or an explicit env acknowledgement, both surfaced on the setup/profile screen.
 */

/** A suggested env var for a profile's preset (key + why, optional example value). */
export interface PresetEnv { key: string; value?: string; why: string }

/** The posture for one deployment profile — what it is and what it relaxes. */
export interface ProfilePosture {
  id: string;
  label: string;
  order: number;
  /** The profile chosen when none is set (exactly one profile carries this). */
  default?: boolean;
  /** Who this profile is for (shown in the setup picker). */
  audience: string;
  /** Does the profile assume the gateway is served over HTTPS? */
  tls: "required" | "lan-ok";
  /** Default severity of running without an IdP (demo auth = everyone admin). */
  demoAuthSeverity: "critical" | "warn" | "info";
  summary: string;
  /** What the profile relaxes vs the strict baseline (for the picker). */
  relaxes: string[];
  /** Suggested env to set for this customer type (the preset). */
  presetEnv: PresetEnv[];
  /** What we'd recommend an operator on this profile do next. */
  recommend: string[];
}

// The generic core (sort → byId → get/list/has); the profile-specific accessors below layer over it.
const catalogue = defineCatalogue<ProfilePosture>(DEPLOYMENT_PROFILES_DATA, { sortByOrder: true });

/** Every shipped profile posture, in display order (strict → relaxed). */
export const DEPLOYMENT_PROFILE_POSTURES: ProfilePosture[] = catalogue.all;

/** The profile ids, in display order — the authoritative "which profiles exist" list (was a code constant). */
export const DEPLOYMENT_PROFILE_IDS: string[] = catalogue.ids;

/** True when `id` is a shipped deployment profile. */
export function isDeploymentProfile(id: string | null | undefined): boolean {
  return catalogue.has(id);
}

/** One profile's posture by id, or undefined. */
export function getProfilePosture(id: string): ProfilePosture | undefined {
  return catalogue.get(id);
}

/** The default profile id (the JSON asset flagged `default`, else the first in order). */
export function defaultDeploymentProfile(): string {
  return (catalogue.all.find((p) => p.default) ?? catalogue.all[0])?.id ?? "business";
}

/** The picker catalogue keyed by id (a defensive copy) — every profile's posture + per-customer-type preset. */
export function profilePostureCatalogue(): Record<string, ProfilePosture> {
  return Object.fromEntries(catalogue.list().map((p) => [p.id, p]));
}
