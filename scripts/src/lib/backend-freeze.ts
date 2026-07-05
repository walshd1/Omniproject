/**
 * Backend-catalogue growth freeze.
 *
 * The catalogue's 41 backends are all "catalogued" — declarative JSON built from
 * public API docs, never exercised against a real live instance (see
 * `VerificationStatus` in `lib/backend-catalogue/src/backend-manifest.ts`). Rather
 * than keep adding breadth on an unverified foundation, the catalogue is frozen at
 * its current size until a flagship set spanning the catalogue's major categories
 * (PM, CRM, ITSM, ERP) is actually verified end-to-end. See
 * `lib/backend-catalogue/vendors/README.md#catalogue-freeze` for the policy this
 * backs and how to lift it.
 *
 * SCOPE: this is a build-time contribution policy (called from `gen-vendors.ts`,
 * which embeds the SHIPPED catalogue), not a runtime security control. A
 * deployment's own `$OMNI_CONFIG_DIR/vendors/backends/*.json` overlay is schema
 * -validated at boot but is NOT subject to this freeze — that overlay is trusted
 * operator config, not catalogue growth this policy is meant to gate.
 */

export const CATALOGUE_BASELINE_COUNT = 41;

export const FLAGSHIP_BACKEND_IDS = ["jira", "asana", "salesforce", "servicenow", "sap"] as const;

export interface VerifiableBackend {
  id: string;
  verification?: string;
}

/**
 * Throws if the catalogue has grown past its baseline while any flagship backend
 * is still unverified. Adding a 42nd+ backend is fine once every flagship id below
 * carries `"verification": "verified"`.
 */
export function checkCatalogueFreeze(backends: VerifiableBackend[]): void {
  if (backends.length <= CATALOGUE_BASELINE_COUNT) return;
  const unverified = FLAGSHIP_BACKEND_IDS.filter(
    (id) => backends.find((b) => b.id === id)?.verification !== "verified",
  );
  if (unverified.length === 0) return;
  throw new Error(
    `Backend catalogue is frozen at ${CATALOGUE_BASELINE_COUNT} backends until the flagship set is verified ` +
      `against a live instance. Still unverified: ${unverified.join(", ")}. ` +
      "See lib/backend-catalogue/vendors/README.md#catalogue-freeze.",
  );
}
