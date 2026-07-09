import fs from "node:fs";
import path from "node:path";
import { sealConfig, readMaybeSealed, isUndecryptableSealed, ConfigDecryptError } from "./config-crypto";
import { logger } from "./logger";

/**
 * One home for the "durable state file, sealed at rest" pattern. Several modules
 * (ai-providers, scim, audit-chain, security-state, config-store) each hand-rolled the same
 * three steps: resolve a path from an env var (optionally under OMNI_CONFIG_DIR), read +
 * decrypt it on first use, and seal + write it back on change. This collapses that boilerplate
 * to one tested helper so the encryption + error handling can never drift between modules.
 *
 * Each module keeps its OWN parse/validate/merge logic (that's domain-specific) — this owns
 * only the I/O + sealing + the lazy-load-once guard.
 */

/** Resolve a config file path: an explicit env override wins; otherwise `defaultName` under
 *  OMNI_CONFIG_DIR (or null if neither is set, meaning "no persistence"). */
export function resolveConfigFile(explicitEnv: string, defaultName?: string): string | null {
  const explicit = process.env[explicitEnv]?.trim();
  if (explicit) return explicit;
  if (!defaultName) return null;
  const dir = process.env["OMNI_CONFIG_DIR"]?.trim();
  return dir ? path.join(dir, defaultName) : null;
}

export class SealedFile {
  private loadedOnce = false;

  /** @param resolvePath returns the file path (or null = persistence disabled); called per
   *  access so env changes in tests are honoured. @param label names the module in logs. */
  constructor(private readonly resolvePath: () => string | null, private readonly label: string) {}

  /** Whether persistence is configured (a path resolves). */
  get enabled(): boolean {
    return this.resolvePath() !== null;
  }

  /** Clear the loaded-once guard so the next {@link loadOnce} re-reads. Test-only. */
  reset(): void {
    this.loadedOnce = false;
  }

  /** The decrypted file contents, or null when persistence is off or the file is absent. An
   *  undecryptable sealed file (wrong/rotated/lost key) is logged and read as null — but is NOT
   *  treated as empty by {@link write}, which refuses to overwrite it (see below). */
  read(): string | null {
    const f = this.resolvePath();
    if (!f || !fs.existsSync(f)) return null;
    try {
      return readMaybeSealed(fs.readFileSync(f, "utf8"));
    } catch (err) {
      if (err instanceof ConfigDecryptError) {
        logger.error({ file: f }, `${this.label}: sealed file could not be decrypted (wrong/rotated/lost key?) — NOT loading defaults over it`);
        return null;
      }
      throw err;
    }
  }

  /** Seal + write the serialized content. Persistence-off is a no-op; I/O errors are logged,
   *  not thrown (a durable-state write must never take down a request). REFUSES to overwrite an
   *  existing sealed file that can't currently be decrypted — otherwise a key mismatch would seal
   *  default/empty state over valid ciphertext and permanently destroy the store. */
  write(content: string): void {
    const f = this.resolvePath();
    if (!f) return;
    try {
      if (fs.existsSync(f) && isUndecryptableSealed(fs.readFileSync(f, "utf8"))) {
        logger.error({ file: f }, `${this.label}: refusing to overwrite — existing sealed file can't be decrypted (wrong/rotated key?); fix the key or move the file to proceed`);
        return;
      }
      fs.writeFileSync(f, sealConfig(content));
    } catch (err) {
      logger.warn({ err }, `${this.label}: failed to persist`);
    }
  }

  /** Lazy restore-once: on the first call, read the file and hand the raw decrypted string to
   *  `apply` (which parses + merges into the module's state). A parse failure is logged and the
   *  module keeps its defaults. Subsequent calls are no-ops. */
  loadOnce(apply: (raw: string) => void): void {
    if (this.loadedOnce) return;
    this.loadedOnce = true;
    const raw = this.read();
    if (raw === null) return;
    try {
      apply(raw);
    } catch (err) {
      logger.warn({ err }, `${this.label}: failed to restore — using defaults`);
    }
  }
}
