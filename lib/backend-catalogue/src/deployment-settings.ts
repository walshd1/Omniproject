import { BROKERS } from "./broker-catalogue";
import { BACKENDS } from "./backend-catalogue";
import { METHODOLOGIES } from "./methodology-catalogue";

/**
 * DEPLOYMENT SETTINGS — the settings a deployment type tags with a value. Each setting is a first-class
 * descriptor (key + label + allowed values); a deployment type's `setup` tags each with the value it should
 * take. Some settings are ADMIN-PICKABLE — the type recommends a value, but the admin may override it from the
 * options (notably the broker + backend, whose choices come live from the broker/backend catalogues). Since
 * only ONE deployment type is active per org at a time, this is the org-level, admin-gated configuration.
 */

export interface DeploymentSetting {
  key: string;
  label: string;
  /** True when an admin may override the deployment type's recommended value (e.g. pick a broker/backend). */
  pickable: boolean;
  /** The allowed values — the picker options for a pickable setting, else the known enum. */
  options: string[];
}

/** The built-in broker homes (not in the external broker catalogue) an admin may also pick. */
const BUILTIN_BROKERS = ["builtin:omnistore", "builtin:postgres", "builtin:memory"];
/** The first-party backends (not third-party) an admin may also pick. */
const BUILTIN_BACKENDS = ["omnistore", "sidecar", "external"];

/** The deployment settings catalogue — every setting a deployment type can tag, with its options. Broker +
 *  backend options are drawn LIVE from the catalogues (built-in homes ∪ catalogued kinds), so the picker
 *  always offers exactly what this build supports. */
export function deploymentSettings(): DeploymentSetting[] {
  return [
    { key: "storage", label: "Storage", pickable: true, options: ["omnistore", "sql-sidecar", "external"] },
    { key: "auth", label: "Authentication", pickable: false, options: ["internal", "idp", "both"] },
    { key: "broker", label: "Broker", pickable: true, options: [...BUILTIN_BROKERS, ...BROKERS.map((b) => b.id)] },
    { key: "backend", label: "Backend", pickable: true, options: [...BUILTIN_BACKENDS, ...BACKENDS.map((b) => b.id)] },
    { key: "residency", label: "Data residency", pickable: false, options: ["off", "on", "multi"] },
    { key: "methodology", label: "Methodology", pickable: true, options: METHODOLOGIES.map((m) => m.id) },
    { key: "audit", label: "Audit", pickable: false, options: ["standard", "strict"] },
    { key: "backups", label: "Backups", pickable: false, options: ["manual", "scheduled", "continuous"] },
  ];
}

/** A resolved setup annotated with each setting's descriptor + the value the deployment type tagged it with —
 *  "settings tagged with the deployment type and the value it sets". Settings absent from the setup are omitted. */
export function describeDeploymentSetup(setup: Record<string, string>): Array<DeploymentSetting & { value: string }> {
  return deploymentSettings()
    .filter((s) => setup[s.key] !== undefined)
    .map((s) => ({ ...s, value: setup[s.key]! }));
}

/**
 * Apply admin OVERRIDES onto a resolved setup — only PICKABLE settings whose new value is a valid option are
 * accepted (so an admin can swap the broker/backend the type recommended, but can't set a non-pickable setting
 * or an unknown value). Returns the merged setup + the rejected keys. Pure.
 */
export function applyDeploymentOverrides(
  setup: Record<string, string>,
  overrides: Record<string, string>,
): { setup: Record<string, string>; rejected: string[] } {
  const byKey = new Map(deploymentSettings().map((s) => [s.key, s]));
  const out = { ...setup };
  const rejected: string[] = [];
  for (const [k, v] of Object.entries(overrides)) {
    const s = byKey.get(k);
    if (s && s.pickable && s.options.includes(v)) out[k] = v;
    else rejected.push(k);
  }
  return { setup: out, rejected };
}
