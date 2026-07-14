import { create } from "zustand";
import { setResponseObserver } from "@workspace/api-client-react";

/**
 * Client-side data-quality signal. The gateway's read sanitizer repairs malformed backend data
 * fail-soft and reports how many fields it had to repair per response via the X-OmniProject-Data-Repaired
 * header. This store captures that header (through the shared customFetch response observer) so the UI
 * can show a subtle, honest badge when the connected backend is feeding dirty data — the totals stay
 * sound (nothing is summed raw), but the operator should know the source data has quality issues.
 */
const HEADER = "X-OmniProject-Data-Repaired";

interface DataQualityState {
  /** Any malformed field seen this session — the sticky signal that drives the badge. */
  everRepaired: boolean;
  /** Repair count from the most recent response that reported any (for the tooltip). */
  lastRepaired: number;
  note: (count: number) => void;
}

export const useDataQuality = create<DataQualityState>((set) => ({
  everRepaired: false,
  lastRepaired: 0,
  note: (count) => set({ everRepaired: true, lastRepaired: count }),
}));

let installed = false;
/** Register the response observer once so every API response's repair count feeds the store. */
export function installDataQualityObserver(): void {
  if (installed) return;
  installed = true;
  setResponseObserver(({ headers }) => {
    const raw = headers.get(HEADER);
    const n = raw ? Number(raw) : 0;
    if (Number.isFinite(n) && n > 0) useDataQuality.getState().note(n);
  });
}
