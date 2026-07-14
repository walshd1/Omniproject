import { describe, it, expect } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
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

  it("dashes the owner cell when a benefit has no owner", () => {
    renderWithProviders(<BenefitsRealisation projectId="p1" />, {
      client: seed([issue({ id: "a", title: "Ownerless", plannedBenefitValue: 1000, actualBenefitValue: 100, benefitStatus: "on_track" })]),
    });
    // benefitOwner falsy → the `benefitOwner || "—"` fallback renders a dash.
    expect(screen.getByTestId("benefit-row-a")).toHaveTextContent("—");
  });

  it("renders the at-risk / missed / not-started RAG buckets", () => {
    renderWithProviders(<BenefitsRealisation projectId="p1" />, {
      client: seed([
        issue({ id: "r", title: "Risky", plannedBenefitValue: 100, actualBenefitValue: 10, benefitStatus: "at risk" }),
        issue({ id: "m", title: "Missed", plannedBenefitValue: 100, actualBenefitValue: 0, benefitStatus: "failed" }),
        issue({ id: "n", title: "New", plannedBenefitValue: 100, benefitStatus: "backlog" }),
      ]),
    });
    const rag = screen.getByTestId("benefits-rag");
    expect(rag).toHaveTextContent(/At risk/);
    expect(rag).toHaveTextContent(/Missed/);
    expect(rag).toHaveTextContent(/Not started/);
  });

  it("surfaces an error with a retry control when the issues query fails", async () => {
    // Nothing seeded → the money hook's issues fetch fails in jsdom, driving the error surface.
    renderWithProviders(<BenefitsRealisation projectId="p1" />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    const retry = screen.getByRole("button", { name: /retry/i });
    fireEvent.click(retry); // exercises DataState onRetry → refetch()
    expect(retry).toBeInTheDocument();
  });
});
