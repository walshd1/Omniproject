import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useSkillsPlanning, skillsPlanningQueryKey, type SkillsPlanning } from "./skills";

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function stubSettings(body: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } })));
}

describe("skillsPlanningQueryKey", () => {
  it("is a stable single-segment key", () => {
    expect(skillsPlanningQueryKey).toEqual(["skills-planning"]);
  });
});

describe("useSkillsPlanning", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("returns the stored skillsPlanning when configured", async () => {
    const planning: SkillsPlanning = {
      matrix: [{ resourceId: "r1", skills: { react: 4 } } as unknown as SkillsPlanning["matrix"][number]],
      demand: [{ skill: "react", hours: 40 } as unknown as SkillsPlanning["demand"][number]],
    };
    stubSettings({ skillsPlanning: planning });
    const { result } = renderHook(() => useSkillsPlanning(), { wrapper: wrapper(client()) });
    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect(result.current.data).toEqual(planning);
  });

  it("falls back to empty matrix + demand when settings have no skillsPlanning", async () => {
    stubSettings({});
    const { result } = renderHook(() => useSkillsPlanning(), { wrapper: wrapper(client()) });
    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect(result.current.data).toEqual({ matrix: [], demand: [] });
  });
});
