import { useMemo } from "react";
import type { Capabilities } from "@workspace/api-client-react";
import { loadDeltas, type LoadInput } from "../../lib/resource-load";

interface IssueLike {
  id: string;
  assignee?: string | null;
}

interface ResultItem {
  id: string;
  title: string;
  status: string;
  resolvedStartDay: number;
  resolvedEndDay: number;
  baseStartDay: number;
  baseEndDay: number;
}

interface UseResourceContentionArgs {
  issues: IssueLike[] | undefined;
  result: { items: ResultItem[] };
  caps: Capabilities | undefined;
  itemsLength: number;
}

/**
 * Resource capacity what-if: join each scheduled item with its assignee, then
 * compare per-person task overlap before vs after the shifts — who has the
 * scenario newly piled up? Concurrency-based, gated on the resources capability.
 */
export function useResourceContention({ issues, result, caps, itemsLength }: UseResourceContentionArgs) {
  const resourcesOn = caps?.resources !== false;
  const assigneeOf = useMemo(() => {
    const m: Record<string, string | null> = {};
    for (const i of issues ?? []) m[i.id] = i.assignee ?? null;
    return m;
  }, [issues]);
  const hasAssignees = Object.values(assigneeOf).some(Boolean);
  const contention = useMemo(() => {
    const active = (status: string) => status !== "done" && status !== "cancelled";
    const toLoad = (resolved: boolean): LoadInput[] =>
      result.items.map((it) => ({
        id: it.id,
        title: it.title,
        assignee: assigneeOf[it.id] ?? null,
        startDay: resolved ? it.resolvedStartDay : it.baseStartDay,
        endDay: resolved ? it.resolvedEndDay : it.baseEndDay,
        active: active(it.status),
      }));
    return loadDeltas(toLoad(false), toLoad(true));
  }, [result, assigneeOf]);
  const showCapacity = resourcesOn && hasAssignees && itemsLength > 0;

  return { contention, showCapacity };
}
