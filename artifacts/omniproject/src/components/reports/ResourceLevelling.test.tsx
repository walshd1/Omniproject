import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import {
  getListProjectsQueryKey,
  getGetProjectCapacityQueryKey,
  getGetCapabilitiesQueryKey,
  type Project,
  type ResourceCapacity,
  type Capabilities,
} from "@workspace/api-client-react";
import { renderWithProviders } from "../../test/utils";
import { ResourceLevelling } from "./ResourceLevelling";

function project(over: Partial<Project> = {}): Project {
  return { id: "p1", name: "P1", identifier: "P1", source: "jira", issueCount: 0, completedCount: 0, memberCount: 0, updatedAt: "", ...over } as Project;
}
function res(over: Partial<ResourceCapacity> = {}): ResourceCapacity {
  return { resourceId: "r", resourceName: "x", role: "eng", allocationPercentage: 80, assignedHours: 32, availableHours: 40, utilizationState: "OPTIMAL", ...over } as ResourceCapacity;
}
function caps(over: Partial<Capabilities> = {}): Capabilities {
  return { mode: "demo", issues: true, scheduling: true, resources: true, financials: true, portfolio: true, baseline: true, blockers: true, history: true, raid: true, quality: true, crm: true, service: true, benefits: true, stakeholders: true, raci: true, timeTravel: false, ...over } as Capabilities;
}

function seed(projects: Project[], capacity: Record<string, ResourceCapacity[]>, capabilities?: Capabilities): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  qc.setQueryData(getListProjectsQueryKey(), projects);
  for (const [id, list] of Object.entries(capacity)) qc.setQueryData(getGetProjectCapacityQueryKey(id), list);
  if (capabilities) qc.setQueryData(getGetCapabilitiesQueryKey(), capabilities);
  return qc;
}

describe("ResourceLevelling", () => {
  it("shows the empty state when no project reports capacity", () => {
    renderWithProviders(<ResourceLevelling />, { client: seed([project({ id: "a" })], { a: [] }) });
    expect(screen.getByTestId("levelling-empty")).toBeInTheDocument();
  });

  it("surfaces a person over-allocated portfolio-wide even though no single row exceeds 100%", () => {
    renderWithProviders(<ResourceLevelling />, {
      client: seed(
        [
          project({ id: "a", name: "Alpha", programmeId: "prog-1", programmeName: "Platform" }),
          project({ id: "b", name: "Beta", programmeId: "prog-2", programmeName: "Growth" }),
        ],
        {
          a: [res({ resourceId: "r1", resourceName: "Ada", allocationPercentage: 60, assignedHours: 24, availableHours: 40 })],
          b: [res({ resourceId: "r1", resourceName: "Ada", allocationPercentage: 60, assignedHours: 24, availableHours: 40 })],
        },
      ),
    });
    expect(screen.getByTestId("resource-levelling")).toBeInTheDocument();
    const row = screen.getByTestId("levelling-person-r1");
    expect(row).toHaveTextContent("120%");
    expect(row).toHaveTextContent("Ada");
  });

  it("shows a skills-empty state when the backend declares no skill tags", () => {
    renderWithProviders(<ResourceLevelling />, {
      client: seed([project({ id: "a" })], { a: [res({ resourceId: "r1" })] }),
    });
    expect(screen.getByTestId("levelling-skills-empty")).toBeInTheDocument();
  });

  it("balances skills supply vs demand when the backend declares skill tags", () => {
    renderWithProviders(<ResourceLevelling />, {
      client: seed(
        [project({ id: "a" })],
        { a: [res({ resourceId: "r1", skills: ["backend"], availableHours: 40, assignedHours: 10 })] },
      ),
    });
    const row = screen.getByTestId("levelling-skill-backend");
    expect(row).toHaveTextContent("backend");
    expect(row).toHaveTextContent("surplus");
  });

  it("shows the residency banner only when residency enforcement is on", () => {
    const client = seed([project({ id: "a" })], { a: [res({ resourceId: "r1" })] }, caps({ residency: { enabled: true, allowedRegions: ["eu"] } }));
    renderWithProviders(<ResourceLevelling />, { client });
    expect(screen.getByTestId("levelling-residency-banner")).toHaveTextContent("eu");
  });

  it("does not show the residency banner when enforcement is off", () => {
    const client = seed([project({ id: "a" })], { a: [res({ resourceId: "r1" })] }, caps({ residency: { enabled: false, allowedRegions: [] } }));
    renderWithProviders(<ResourceLevelling />, { client });
    expect(screen.queryByTestId("levelling-residency-banner")).not.toBeInTheDocument();
  });

  it("renders the move/scenario sandbox with no result until a person + projects are chosen", () => {
    renderWithProviders(<ResourceLevelling />, {
      client: seed([project({ id: "a" })], { a: [res({ resourceId: "r1" })] }),
    });
    expect(screen.getByTestId("levelling-move-sandbox")).toBeInTheDocument();
    expect(screen.queryByTestId("levelling-move-result")).not.toBeInTheDocument();
  });

  it("shows nobody-contended message when capacity is level", () => {
    renderWithProviders(<ResourceLevelling />, {
      client: seed([project({ id: "a" })], { a: [res({ resourceId: "r1", allocationPercentage: 90, assignedHours: 36, availableHours: 40 })] }),
    });
    expect(screen.getByTestId("resource-levelling")).toHaveTextContent("Nobody is over- or under-allocated");
  });
});
