import { useQuery } from "@tanstack/react-query";
import { getJson } from "./api";

/** Health-watch client: trigger a scan (admin) and read recent findings (manager+). */
export type Severity = "critical" | "warning" | "info";

export interface HealthFinding {
  ruleId: string;
  projectId: string;
  projectName: string;
  severity: Severity;
  message: string;
  at: string;
}

/** Recent findings raised by the watch. */
export function useHealthFindings() {
  return useQuery<{ findings: HealthFinding[] }>({
    queryKey: ["health-findings"],
    queryFn: () => getJson("/api/health-watch"),
    staleTime: 15_000,
  });
}

/** Trigger a scan now (admin); returns the findings it raised. */
export async function runHealthWatch(): Promise<HealthFinding[]> {
  const res = await fetch("/api/health-watch/run", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" } });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Scan failed (${res.status})`);
  }
  return ((await res.json()) as { findings: HealthFinding[] }).findings;
}
