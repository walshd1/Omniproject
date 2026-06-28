import { vendorOverlayEntries } from "@workspace/backend-catalogue";
import { buildSnapshot } from "./config-snapshot";
import { sealConfig } from "./config-crypto";
import { getSettings } from "./settings";
import { getFieldRules, getRuleModes } from "./ruleset";
import { buildZip, type ZipEntry } from "./zip";

/**
 * "Lock this config" export — dump the current effective config as the EXACT
 * folder-of-JSON the config-directory loader reads (read ≡ dump). The customer
 * keeps the bundle and mounts it as OMNI_CONFIG_DIR to persist their look-and-feel;
 * the gateway itself stores nothing.
 *
 *   config.json              the settings snapshot (settings + label overrides)
 *   vendors/<plane>/<id>.json the deployment's overlay vendors (its own additions)
 *   rulesets/field-rules.json + rule-modes.json   the governance ruleset
 *
 * Contains only CONFIG — never customer project/issue data (that is brokered live).
 */

/**
 * Build the config bundle as a ZIP buffer mirroring the OMNI_CONFIG_DIR layout.
 *
 * The SENSITIVE snapshot files (config.json — settings, capability states, endpoints —
 * and the governance rulesets) are SEALED at rest under the deployment's internal key, so
 * a copy of the mounted folder is opaque off-box. The loader (config-dir) decrypts them
 * transparently on the SAME deployment. Vendor overlay files are catalogue definitions
 * (not secrets) and stay plaintext. To move config to a DIFFERENT deployment use the
 * ephemeral export bundle (POST /api/security/config/export) instead.
 */
export function buildConfigBundle(): Buffer {
  const entries: ZipEntry[] = [];
  const addJson = (name: string, obj: unknown): void => {
    entries.push({ name, data: Buffer.from(JSON.stringify(obj, null, 2) + "\n") });
  };
  // Sealed at rest (sensitive config); decrypted transparently by the loader.
  const addSealed = (name: string, obj: unknown): void => {
    entries.push({ name, data: Buffer.from(sealConfig(JSON.stringify(obj, null, 2)) + "\n") });
  };

  addSealed("config.json", buildSnapshot(getSettings()));

  const overlay = vendorOverlayEntries();
  for (const [plane, defs] of Object.entries(overlay)) {
    for (const def of defs) addJson(`vendors/${plane}/${def.id}.json`, def);
  }

  addSealed("rulesets/field-rules.json", getFieldRules());
  addSealed("rulesets/rule-modes.json", getRuleModes());

  return buildZip(entries);
}
