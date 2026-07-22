/**
 * The repository root, resolved once from this file's fixed location (scripts/src/lib/). The single
 * answer to "where is repo root" for the generator + guard scripts, replacing the
 * `path.dirname(fileURLToPath(import.meta.url))` + `path.resolve(HERE, "../..")` dance each one used to
 * re-type. Distinct from gen-registry's own private copy only by convenience of import.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Absolute path to the monorepo root. */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
