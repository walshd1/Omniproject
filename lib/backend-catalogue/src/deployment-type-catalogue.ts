import { DEPLOYMENT_TYPES_DATA } from "./deployment-types.generated";

/**
 * DEPLOYMENT-TYPE catalogue — the archetypes a user picks on the way in (solo self-hoster, small team,
 * managed cloud, enterprise on-prem, regulated self-host). Modelled on the methodology catalogue: authored
 * as one JSON file per type under assets/deployment-types/<id>.json, validated + embedded by
 * gen-deployment-types, drift-guarded in CI. Pick a type, answer a few questions, and
 * {@link resolveDeploymentSetup} folds the answers into a known-good setup (storage / auth / broker /
 * residency / methodology / audit / backups).
 */

/** One question asked after picking a type; the answer may refine the setup. */
export interface DeploymentQuestion {
  id: string;
  label: string;
  help?: string;
  options: Array<{ value: string; label: string }>;
  /** The value used when the question is left unanswered. */
  default: string;
}

/** A conditional override: when ALL of `when` matches the answers, `set` merges onto the setup. */
export interface DeploymentRefinement {
  when: Record<string, string>;
  set: Record<string, string>;
}

export interface DeploymentType {
  id: string;
  label: string;
  description: string;
  order: number;
  questions?: DeploymentQuestion[];
  /** The known-good base setup (recommended config keys → values). */
  setup: Record<string, string>;
  refinements?: DeploymentRefinement[];
  notes?: string;
}

/** Every shipped deployment type, in display order. */
export const DEPLOYMENT_TYPES: DeploymentType[] = [...DEPLOYMENT_TYPES_DATA].sort((a, b) => a.order - b.order);

const byId = new Map(DEPLOYMENT_TYPES.map((d) => [d.id, d]));

/** One deployment type by id, or undefined. */
export function getDeploymentType(id: string): DeploymentType | undefined {
  return byId.get(id);
}

/** All deployment types (a defensive copy). */
export function deploymentTypeCatalogue(): DeploymentType[] {
  return DEPLOYMENT_TYPES.map((d) => ({ ...d }));
}
