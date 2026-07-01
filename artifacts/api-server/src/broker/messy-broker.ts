import type { Broker, Row } from "./types";
import { isDevMode } from "../lib/dev-mode";
import { getMessyConfig, messifyRows, messifyRow } from "../lib/messy-data";

/**
 * Messy-data broker decorator — DEV MODE ONLY.
 *
 * Wraps the active broker so its READ results are passed through the messy-data
 * transform (lib/messy-data) before the app sees them, injecting real-world
 * imperfections (nulls, missing fields, mixed enum vocab, junk numbers/dates,
 * missing provenance, id collisions…) into the read model. This lets us watch how
 * resilient our reports/derivations/screens are to dirty data without waiting for a
 * customer's real backend to expose the weak spot.
 *
 * HARD-GATED: `messyDataArmed()` is false unless dev mode is active (and dev mode is
 * itself false in production), so a released deployment never messifies anything. It
 * only touches READS — writes pass through untouched — and it never mutates the
 * backing store; the mess is applied to a shallow copy on the way out.
 */

/** Read methods that return entity ROWS worth messifying (the raw read model). We
 *  deliberately leave our OWN derived/meta outputs (summaries, history, baselines,
 *  capabilities, fx) alone — the point is to feed derivations dirty INPUTS. */
const MESSY_METHODS = new Map<string, "rows" | "row">([
  ["listProjects", "rows"],
  ["listIssues", "rows"],
  ["listActivity", "rows"],
  ["listRaid", "rows"],
  ["notifications", "rows"],
  ["portfolioHealth", "rows"],
  ["resourceCapacity", "rows"],
  ["projectMembers", "rows"],
  ["getIssue", "row"],
  ["projectFinancials", "row"],
]);

/** Is the messy-data transform armed? Only ever true in dev mode. */
export function messyDataArmed(): boolean {
  return isDevMode() && getMessyConfig().on;
}

/** Wrap a broker so its entity reads are messified (dev only). */
export function wrapWithMessy(base: Broker): Broker {
  return new Proxy(base, {
    get(target, prop, receiver) {
      const orig = Reflect.get(target, prop, receiver);
      if (typeof orig !== "function") return orig;
      const method = String(prop);
      const mode = MESSY_METHODS.get(method);
      if (!mode) return (orig as (...a: unknown[]) => unknown).bind(target);

      return async function (this: unknown, ...args: unknown[]) {
        const result = await (orig as (...a: unknown[]) => Promise<unknown>).apply(target, args);
        const config = getMessyConfig();
        if (mode === "rows" && Array.isArray(result)) return messifyRows(result as Row[], config, method);
        if (mode === "row" && result && typeof result === "object") return messifyRow(result as Row, config, method);
        return result;
      };
    },
  }) as Broker;
}
