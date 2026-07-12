import { useMemo } from "react";
import { CANONICAL_FIELD_KEYS } from "@workspace/backend-catalogue";
import { useAuth, roleAtLeast } from "./auth";
import { useAvailability } from "./availability";
import { useFieldRouting } from "./routing";
import { useCustomFields } from "./custom-fields";
import { useSetupStatus } from "./setup";

const CANONICAL = [...CANONICAL_FIELD_KEYS].sort();
const uniq = (xs: string[]): string[] => [...new Set(xs)];

export interface PickableFields {
  /** The fields to OFFER in an admin picker: the surfaced superset portion ∪ custom fields ∪
   *  whatever is already mapped (existing routes must always stay selectable). */
  fields: string[];
  /** True once we've narrowed the superset to what backends advertise — i.e. a real broker is wired
   *  and returned an availability set. False (⇒ show the whole superset) while loading or in demo. */
  restricted: boolean;
  /** Backend-advertised available superset fields (empty until a live broker reports them). */
  advertised: string[];
  /** UI elements already mapped in the routing matrix. */
  mapped: string[];
  /** Admin-defined custom field keys (always offerable — they EXTEND the superset). */
  custom: string[];
}

/**
 * The single source of truth for "which fields may an admin pick". Instead of offering the entire
 * reference superset, we surface only what is real RIGHT NOW: the fields a wired-up backend advertises
 * as available (`useAvailability().available`) plus anything already mapped, plus the admin's own
 * custom fields. Going beyond that advertised set is a DELIBERATE act (wire another backend/broker, or
 * turn on the Postgres sidecar) — not the default.
 *
 * Fallback is permissive (the whole superset) while the availability/broker state is loading or when no
 * live broker is wired (demo), matching the app's other capability-gating helpers so the picker never
 * flickers empty.
 */
export function usePickableFields(): PickableFields {
  const { data: auth } = useAuth();
  const isAdmin = roleAtLeast(auth?.role, "admin");
  const { data: avail } = useAvailability();
  const { data: routing } = useFieldRouting();
  const { data: customFields } = useCustomFields();
  const { data: status } = useSetupStatus({ enabled: isAdmin });

  return useMemo(() => {
    const mapped = (routing ?? []).map((r) => r.uiElement).filter(Boolean);
    const custom = (customFields ?? []).map((c) => c.key);
    const advertised = avail?.available ?? [];
    const brokerWired = !!status?.broker?.configured;
    const restricted = brokerWired && !!avail && advertised.length > 0;

    // Restricted: the advertised superset fields plus any already-mapped canonical field (so existing
    // routes never vanish). Unrestricted: the full canonical superset.
    const supersetPart = restricted
      ? uniq([...advertised, ...mapped.filter((m) => CANONICAL_FIELD_KEYS.has(m))])
      : CANONICAL;

    const fields = uniq([...supersetPart, ...custom, ...mapped]);
    return { fields, restricted, advertised, mapped, custom };
  }, [avail, routing, customFields, status]);
}
