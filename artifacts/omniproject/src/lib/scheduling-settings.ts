import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getJson } from "./api";
import { makeWorkingCalendar, DEFAULT_WORKING_CALENDAR, type WorkingCalendar, type Weekday } from "./working-calendar";

/**
 * The WORKING-TIME config for the scheduling engine (roadmap 3.1 follow-up) — hours per working day
 * (estimate→duration) plus the working week + holidays that build the {@link WorkingCalendar}. Read from
 * `GET /api/scheduling/resolved`, which folds the `scheduling` config def across scopes
 * (system < org < programme < project < user); safe defaults apply while it loads. This is no longer a
 * `/api/settings` slice — the working-time policy lives in the composition model as a scope-layered config def.
 */

export const DEFAULT_HOURS_PER_DAY = 8;

export const schedulingResolvedKey = ["scheduling", "resolved"] as const;
export const schedulingOrgKey = ["scheduling", "org"] as const;

export interface SchedulingSettings {
  hoursPerDay: number;
  calendar: WorkingCalendar;
}

/** The raw shape of a resolved `scheduling` config (all optional; validated server-side). */
export interface RawSchedulingConfig {
  hoursPerDay?: number;
  workingWeekdays?: number[];
  holidays?: string[];
}

/** Resolve a raw config to a usable hours/day + working calendar, applying defaults defensively. */
export function resolveSchedulingSettings(raw: RawSchedulingConfig | undefined): SchedulingSettings {
  const hoursPerDay = typeof raw?.hoursPerDay === "number" && raw.hoursPerDay > 0 ? raw.hoursPerDay : DEFAULT_HOURS_PER_DAY;
  const calendar = raw
    ? makeWorkingCalendar({
        ...(raw.workingWeekdays ? { workingWeekdays: raw.workingWeekdays as Weekday[] } : {}),
        ...(raw.holidays ? { holidays: raw.holidays } : {}),
      })
    : DEFAULT_WORKING_CALENDAR;
  return { hoursPerDay, calendar };
}

/** Subscribe to the resolved working-time config (hours/day + calendar), with safe defaults while loading. */
export function useSchedulingSettings(): SchedulingSettings {
  const { data } = useQuery({
    queryKey: schedulingResolvedKey,
    queryFn: () => getJson<{ scheduling: RawSchedulingConfig }>("/api/scheduling/resolved"),
    staleTime: 15_000,
  });
  // Memoise: resolveSchedulingSettings builds a fresh WorkingCalendar (new Set/object) each call, so an
  // unmemoised return re-triggers every consumer's forecast/CPM memo on every render (broken-memo thrash).
  return useMemo(() => resolveSchedulingSettings(data?.scheduling), [data]);
}
