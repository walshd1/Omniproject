import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { getGetProjectIssuesQueryKey, type Issue } from "@workspace/api-client-react";
import { renderWithProviders } from "../../test/utils";
import { BenefitsRealisation } from "./BenefitsRealisation";

function issue(over: Partial<Issue> = {}): Issue {
  return { id: "i", projectId: "p1", title: "Task", status: "todo", priority: "high", labels: [], source: "jira", currency: "GBP", ...over } as Issue;
}

function seed(issues: Issue[]): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  qc.setQueryData(getGetProjectIssuesQueryKey("p1"), issues);
  return qc;
}

describe("BenefitsRealisation", () => {
  it("renders the realisation roll-up and RAG spread from benefit fields", () => {
    renderWithProviders(<BenefitsRealisation projectId="p1" />, {
      client: seed([
        issue({ id: "a", title: "Auth", plannedBenefitValue: 120000, actualBenefitValue: 42000, benefitStatus: "on_track", benefitOwner: "alice" }),
        issue({ id: "c", title: "UX", plannedBenefitValue: 50000, actualBenefitValue: 52000, benefitStatus: "realised" }),
      ]),
    });
    expect(screen.getByTestId("benefits")).toBeInTheDocument();
    expect(screen.getByTestId("benefits-rag")).toHaveTextContent(/Realised/);
    expect(screen.getByTestId("benefits-rag")).toHaveTextContent(/On track/);
    expect(screen.getByTestId("benefit-row-a")).toHaveTextContent("alice");
    // Realisation = 94000 / 170000 ≈ 55%
    expect(screen.getByText("55%")).toBeInTheDocument();
  });

  it("shows the empty state when no work item carries a benefit", () => {
    renderWithProviders(<BenefitsRealisation projectId="p1" />, {
      client: seed([issue({ id: "a", title: "Plain" })]),
    });
    expect(screen.getByTestId("benefits-empty")).toBeInTheDocument();
  });
});
