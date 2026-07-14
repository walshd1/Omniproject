import { describe, it, expect, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient } from "@tanstack/react-query";
import {
  getListProjectsQueryKey,
  getGetProjectCapacityQueryKey,
  getGetCapabilitiesQueryKey,
  type Project,
  type ResourceCapacity,
  type Capabilities,
} from "@workspace/api-client-react";
import { renderWithProviders, mockFetchRouter, resetFetchMock } from "../../test/utils";
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

  it("renders over- and under-allocated rows with the cross-country warning and a country dash", () => {
    renderWithProviders(<ResourceLevelling />, {
      client: seed(
        [
          project({ id: "a", name: "Alpha", programmeId: "prog-1", programmeName: "Platform" }),
          project({ id: "b", name: "Beta", programmeId: "prog-2", programmeName: "Growth" }),
        ],
        {
          a: [
            res({ resourceId: "r1", resourceName: "Ada", allocationPercentage: 60, assignedHours: 24, availableHours: 40, country: "GB" }),
            res({ resourceId: "r2", resourceName: "Bob", allocationPercentage: 30, assignedHours: 12, availableHours: 40 }),
          ],
          b: [
            res({ resourceId: "r1", resourceName: "Ada", allocationPercentage: 60, assignedHours: 24, availableHours: 40, country: "FR" }),
          ],
        },
      ),
    });
    const over = screen.getByTestId("levelling-person-r1");
    expect(over).toHaveTextContent("120%");
    expect(over).toHaveTextContent("GB, FR"); // countries joined
    expect(over).toHaveTextContent("⚠"); // crossCountry marker
    const under = screen.getByTestId("levelling-person-r2");
    expect(under).toHaveTextContent("30%");
    expect(under).toHaveTextContent("—"); // no declared country
  });

  it("colours each skill row by its supply/demand pressure (shortage / surplus / balanced)", () => {
    renderWithProviders(<ResourceLevelling />, {
      client: seed([project({ id: "a" })], {
        a: [
          res({ resourceId: "r1", skills: ["backend"], availableHours: 10, assignedHours: 40 }), // demand > supply
          res({ resourceId: "r2", skills: ["frontend"], availableHours: 100, assignedHours: 10 }), // demand < 50% supply
          res({ resourceId: "r3", skills: ["qa"], availableHours: 100, assignedHours: 60 }), // in between
        ],
      }),
    });
    expect(screen.getByTestId("levelling-skill-backend")).toHaveTextContent("shortage");
    expect(screen.getByTestId("levelling-skill-frontend")).toHaveTextContent("surplus");
    expect(screen.getByTestId("levelling-skill-qa")).toHaveTextContent("balanced");
    // Positive balances carry a leading "+".
    expect(screen.getByTestId("levelling-skill-frontend")).toHaveTextContent("+90h");
  });

  it("previews an allowed move once a person + both projects are chosen, with before→after side cards", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ResourceLevelling />, {
      client: seed(
        [
          project({ id: "a", name: "Alpha", programmeId: "prog-1", programmeName: "Platform" }),
          project({ id: "b", name: "Beta", programmeId: "prog-2", programmeName: "Growth" }),
        ],
        {
          // Ada is 50% on Alpha and 95% on Beta; moving 20pts onto Beta tips Beta over 100% (to-side Δ > 0).
          a: [res({ resourceId: "r1", resourceName: "Ada", allocationPercentage: 50, assignedHours: 20, availableHours: 40 })],
          b: [res({ resourceId: "r1", resourceName: "Ada", allocationPercentage: 95, assignedHours: 38, availableHours: 40 })],
        },
      ),
    });

    await user.click(screen.getByLabelText("Person to move"));
    await user.click(await screen.findByRole("option", { name: "Ada" }));
    await user.click(screen.getByLabelText("Origin project"));
    await user.click(await screen.findByRole("option", { name: "Alpha" }));
    await user.click(screen.getByLabelText("Destination project"));
    await user.click(await screen.findByRole("option", { name: "Beta" }));

    expect(screen.getByTestId("levelling-move-result")).toBeInTheDocument();
    expect(screen.getByTestId("levelling-move-side-from")).toBeInTheDocument();
    expect(screen.getByTestId("levelling-move-side-to")).toBeInTheDocument();
    expect(screen.queryByTestId("levelling-move-blocked")).not.toBeInTheDocument();

    // The move % field clamps to 0..100 and coerces junk to 0.
    const pct = screen.getByTestId("levelling-move-percentage");
    fireEvent.change(pct, { target: { value: "150" } });
    expect(pct).toHaveValue(100);
    fireEvent.change(pct, { target: { value: "abc" } });
    expect(pct).toHaveValue(0);
  });

  it("blocks a modelled move when data-residency forbids the resource's country", async () => {
    const user = userEvent.setup();
    const client = seed(
      [
        project({ id: "a", name: "Alpha", programmeId: "prog-1", programmeName: "Platform" }),
        project({ id: "b", name: "Beta", programmeId: "prog-2", programmeName: "Growth" }),
      ],
      {
        a: [res({ resourceId: "r1", resourceName: "Ada", allocationPercentage: 60, assignedHours: 24, availableHours: 40, country: "us" })],
        b: [res({ resourceId: "r1", resourceName: "Ada", allocationPercentage: 60, assignedHours: 24, availableHours: 40, country: "us" })],
      },
      caps({ residency: { enabled: true, allowedRegions: ["eu"] } }),
    );
    renderWithProviders(<ResourceLevelling />, { client });

    await user.click(screen.getByLabelText("Person to move"));
    await user.click(await screen.findByRole("option", { name: "Ada" }));
    await user.click(screen.getByLabelText("Origin project"));
    await user.click(await screen.findByRole("option", { name: "Alpha" }));
    await user.click(screen.getByLabelText("Destination project"));
    await user.click(await screen.findByRole("option", { name: "Beta" }));

    const blocked = screen.getByTestId("levelling-move-blocked");
    expect(blocked).toHaveTextContent(/Move blocked/);
    expect(blocked).toHaveTextContent(/not in the allowed region set/);
    expect(screen.queryByTestId("levelling-move-side-from")).not.toBeInTheDocument();
  });

  it("shows 'none' in the residency banner when enforcement is on but no regions are allowed", () => {
    const client = seed([project({ id: "a" })], { a: [res({ resourceId: "r1" })] }, caps({ residency: { enabled: true, allowedRegions: [] } }));
    renderWithProviders(<ResourceLevelling />, { client });
    expect(screen.getByTestId("levelling-residency-banner")).toHaveTextContent("none");
  });

  describe("error state", () => {
    afterEach(() => resetFetchMock());

    it("renders the error alert and retries the project list on demand", async () => {
      const calls = mockFetchRouter({ "/api/projects": { ok: false, status: 500, body: { error: "projects down" } } });
      renderWithProviders(<ResourceLevelling />);
      expect(await screen.findByRole("alert")).toHaveTextContent(/Could not load/i);
      const projectCalls = () => calls.filter((c) => c.url.includes("/api/projects")).length;
      const before = projectCalls();
      fireEvent.click(screen.getByRole("button", { name: /Retry/i }));
      await waitFor(() => expect(projectCalls()).toBeGreaterThan(before));
    });
  });
});
