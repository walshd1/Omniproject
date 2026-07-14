import { useQuery } from "@tanstack/react-query";
import { getJson } from "./api";

/**
 * Admin-panel lockout for incompatible settings. The server (lib/settings-constraints) is the single
 * source of truth for cross-field incompatibilities; this hook reads the current locks so a panel can
 * DISABLE or FORCE the incompatible control (with the reason) instead of letting an operator pick an
 * illegal combination and get a 400 on save. Mirrors the server enforcement — poka-yoke, not a message.
 */

export type LockState = "disabled" | "forced";

export interface FieldLock {
  /** Dotted settings path the lock applies to (e.g. "fxRateAsOfDate", "loggingSync.enabled"). */
  path: string;
  state: LockState;
  /** For `state:"forced"` — the value the field is pinned to. */
  forcedValue?: unknown;
  /** Human reason naming the driving setting, for the control's title/tooltip. */
  reason: string;
}

export const settingConstraintsQueryKey = ["settings", "constraints"] as const;

/** Read the current settings incompatibility locks and expose a `lockFor(path)` lookup. */
export function useSettingLocks(): { lockFor: (path: string) => FieldLock | undefined; locks: FieldLock[] } {
  const { data } = useQuery<{ locks: FieldLock[] }>({
    queryKey: settingConstraintsQueryKey,
    queryFn: () => getJson("/api/settings/constraints"),
    staleTime: 10_000,
  });
  const locks = data?.locks ?? [];
  const byPath = new Map(locks.map((l) => [l.path, l]));
  return { lockFor: (path) => byPath.get(path), locks };
}
