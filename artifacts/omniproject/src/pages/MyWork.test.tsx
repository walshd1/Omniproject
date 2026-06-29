import { describe, it, expect } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { getListProjectsQueryKey, type Project, type Issue } from "@workspace/api-client-react";
import { renderWithProviders } from "../test/utils";
import { isAssignedToMe, MyWork } from "./MyWork";
import { featuresQueryKey, type FeatureStatus } from "../lib/features";

function project(over: Partial<Project> = {}): Project {
  return {
    id: "proj-1", name: "Alpha", identifier: "ALP", source: "jira",
    issueCount: 1, completedCount: 0, memberCount: 1, updatedAt: new Date(0).toISOString(),
    ...over,
  };
}

function issue(over: Partial<Issue> = {}): Issue {
  return {
    id: "i1", projectId: "proj-1", title: "Fix the thing", status: "in_progress",
    priority: "medium", assignee: "ada@example.com", labels: [], source: "jira",
    ...over,
  } as Issue;
}

function seed(opts: { enabled?: boolean; projects?: Project[]; issuesByProject?: Record<string, Issue[]> } = {}): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(featuresQueryKey, [
    { id: "myWork", label: "My Work / Inbox", description: "", enabled: opts.enabled ?? true, loaded: true, needsRestart: false },
  ] satisfies FeatureStatus[]);
  qc.setQueryData(["auth", "me"], { authenticated: true, mode: "oidc", user: { sub: "u1", email: "ada@example.com", name: "Ada" }, role: "manager" });
  qc.setQueryData(getListProjectsQueryKey(), opts.projects ?? []);
  for (const [pid, issues] of Object.entries(opts.issuesByProject ?? {})) {
    qc.setQueryData(["my-work-issues", pid], issues);
  }
  return qc;
}

describe("MyWork page", () => {
  it("shows the not-enabled note when the module is off", () => {
    renderWithProviders(<MyWork />, { client: seed({ enabled: false }) });
    expect(screen.getByText(/module is not enabled/i)).toBeInTheDocument();
  });

  it("renders items assigned to me, grouped by status, and switches to the inbox tab", () => {
    renderWithProviders(<MyWork />, {
      client: seed({ projects: [project()], issuesByProject: { "proj-1": [issue()] } }),
    });
    expect(screen.getByTestId("my-work-list")).toBeInTheDocument();
    expect(screen.getByText("Fix the thing")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /inbox/i }));
    expect(screen.getByText(/No notifications yet/i)).toBeInTheDocument();
  });

  it("shows the empty state when nothing is assigned to me", () => {
    renderWithProviders(<MyWork />, {
      client: seed({ projects: [project()], issuesByProject: { "proj-1": [issue({ assignee: "someone-else" })] } }),
    });
    expect(screen.getByTestId("my-work-empty")).toBeInTheDocument();
  });
});

describe("isAssignedToMe", () => {
  const me = { sub: "auth0|123", email: "ada@example.com", name: "Ada Lovelace" };

  it("matches on sub, email or name (case-insensitive)", () => {
    expect(isAssignedToMe("auth0|123", me)).toBe(true);
    expect(isAssignedToMe("ADA@EXAMPLE.COM", me)).toBe(true);
    expect(isAssignedToMe("  Ada Lovelace  ", me)).toBe(true);
  });

  it("does not match a different assignee", () => {
    expect(isAssignedToMe("someone-else", me)).toBe(false);
  });

  it("treats empty / null / undefined assignee as unassigned", () => {
    expect(isAssignedToMe(null, me)).toBe(false);
    expect(isAssignedToMe(undefined, me)).toBe(false);
    expect(isAssignedToMe("   ", me)).toBe(false);
  });

  it("never matches when the identity fields are all absent", () => {
    expect(isAssignedToMe("anyone", {})).toBe(false);
  });
});
