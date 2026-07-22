import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getJson, sendJson } from "./api";

/**
 * Factory for the shared-config CRUD pair that a dozen-plus SPA clients repeat verbatim: a named config
 * collection stored under ONE envelope key at ONE endpoint, read as a react-query resource and written
 * back whole. Each of those files was ~20 lines of identical `useQuery` / `useMutation` boilerplate that
 * differed only in the endpoint, the envelope field and how the save reconciles the cache; this collapses
 * them to a spec while keeping every public hook name (each caller re-exports `useResource`/`useSaveResource`
 * under its own name, so nothing at the call sites changes).
 *
 * Two write reconciliations, matching what the endpoints do today:
 *  - `"invalidate"` (default): PUT the envelope, then invalidate the query (plus any `alsoInvalidate` keys —
 *    e.g. the generic `["panel-data"]` the screen panels read the roll-ups under). The server is the truth.
 *  - `"set-from-response"`: PUT the envelope, then seed the cache from the echoed body (no refetch). Used by
 *    the endpoints that return the saved collection.
 */
export interface ConfigResourceSpec<T> {
  /** react-query key for the collection. */
  queryKey: readonly unknown[];
  /** REST endpoint (same path for read + write). */
  path: string;
  /** JSON envelope field the collection sits under, e.g. `"budgetPlans"`. */
  envelopeKey: string;
  /** Value substituted when the server omits the field. Omit when the server always returns it. */
  empty?: T;
  /** react-query `staleTime` (ms). Defaults to 30_000. */
  staleTime?: number;
  /** How a successful save reconciles the cache. Defaults to `"invalidate"`. */
  reconcile?: "invalidate" | "set-from-response";
  /** Error message for the write (used by the `"invalidate"` reconciliation). */
  saveErrorMessage?: string;
  /** Extra query keys to invalidate on a successful save (`"invalidate"` reconciliation only). */
  alsoInvalidate?: readonly (readonly unknown[])[];
}

/**
 * Build the read + write hooks for one shared-config collection. Returns them unnamed so the caller can
 * re-export under the resource's own hook names (`export const useBudgetPlans = r.useResource`).
 */
export function configResource<T>(spec: ConfigResourceSpec<T>) {
  const { queryKey, path, envelopeKey, empty, staleTime = 30_000, reconcile = "invalidate", saveErrorMessage, alsoInvalidate } = spec;

  const useResource = () =>
    useQuery({
      queryKey,
      queryFn: () =>
        getJson<Record<string, T | undefined>>(path).then((r) => {
          const v = r[envelopeKey];
          return (v === undefined ? empty : v) as T;
        }),
      staleTime,
    });

  const useSaveResource = () => {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: (value: T) =>
        reconcile === "set-from-response"
          ? sendJson<Record<string, T>>(path, { [envelopeKey]: value })
          : sendJson<unknown>(path, { [envelopeKey]: value }, "PUT", saveErrorMessage),
      onSuccess: (data) => {
        if (reconcile === "set-from-response") {
          qc.setQueryData(queryKey, (data as Record<string, T>)[envelopeKey]);
        } else {
          qc.invalidateQueries({ queryKey });
          for (const k of alsoInvalidate ?? []) qc.invalidateQueries({ queryKey: k });
        }
      },
    });
  };

  return { useResource, useSaveResource };
}
