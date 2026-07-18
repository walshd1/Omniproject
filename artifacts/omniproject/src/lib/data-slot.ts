import { useQuery } from "@tanstack/react-query";
import { getJson } from "./api";

/**
 * Generic data-slot rows (roadmap §4.6 / §5.5) — the read hook the `register` panel's SLOT source uses to render
 * ANY mapping slot as an editable register. Rows round-trip through the SAME generic surface every slot uses
 * (`/mapping/:slot/rows` to read; `PUT`/`DELETE /mapping/:slot/:rowId` to save, done inline in the register
 * panel's reconcile), so a register/board is a pure JSON screen def over a slot with no bespoke endpoint. Field
 * list + validation come from the resolved mapping (`useResolvedMapping` in field-mapping).
 */

export type SlotRow = Record<string, unknown>;

export function slotRowsQueryKey(projectId: string, slot: string) {
  return ["mapping-rows", slot, projectId] as const;
}

/** The rows authored in a slot for a project. Empty (never throws) until authored / store off. */
export function useSlotRows(projectId: string | undefined, slot: string) {
  return useQuery({
    queryKey: slotRowsQueryKey(projectId ?? "", slot),
    queryFn: () => getJson<{ rows: SlotRow[] }>(`/api/projects/${encodeURIComponent(projectId!)}/mapping/${encodeURIComponent(slot)}/rows`),
    enabled: !!projectId && !!slot,
    retry: false,
    select: (d) => d.rows ?? [],
  });
}
