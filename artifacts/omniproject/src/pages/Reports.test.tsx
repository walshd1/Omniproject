import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import {
  getListProjectsQueryKey,
  getGetCapabilitiesQueryKey,
  type Project,
  type Capabilities,
} from "@workspace/api-client-react";
import { renderWithProviders } from "../test/utils";
import { settingsQueryKey } from "../lib/settings-query";
import { Reports } from "./Reports";

function project(over: Partial<Project> = {}): Project {
  return {
    id: "proj-1",
    name: "Platform Rewrite",
    identifier: "PLT",
    source: "jira",
    issueCount: 10,
    completedCount: 5,
    memberCount: 3,
    updatedAt: new Date(0).toISOString(),
    ...over,
  };
}

function caps(over: Partial<Capabilities> = {}): Capabilities {
  // Default everything to false so the Gated wrappers render their
  // "not available" message instead of mounting fetching report children.
  return {
    mode: "demo",
    issues: false,
    scheduling: false,
    resources: false,
    financials: false,
    portfolio: false,
    baseline: false,
    blockers: false,
    history: false,
    raid: false,
    quality: false,
    crm: false,
    service: false,
    benefits: false,
    stakeholders: false,
    raci: false,
    timeTravel: false,
    ...over,
  };
}

function seed(projects: Project[], c: Capabilities | undefined): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(getListProjectsQueryKey(), projects);
  if (c) qc.setQueryData(getGetCapabilitiesQueryKey(), c);
  return qc;
}

describe("Reports", () => {
  it("renders the reporting title and a project selector when projects exist", () => {
    renderWithProviders(<Reports />, { client: seed([project()], caps()) });
    expect(screen.getByRole("heading", { level: 1, name: /enterprise reporting/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/report project/i)).toBeInTheDocument();
  });

  it("gates report sections that the backend cannot populate", () => {
    renderWithProviders(<Reports />, { client: seed([project()], caps()) });
    // Every domain is false → each Gated section shows its dependency message.
    const gated = screen.getAllByText(/not available for this backend/i);
    expect(gated.length).toBeGreaterThanOrEqual(1);
  });

  it("renders without a project selector when there are no projects", () => {
    renderWithProviders(<Reports />, { client: seed([], caps()) });
    expect(screen.getByRole("heading", { level: 1, name: /enterprise reporting/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/report project/i)).not.toBeInTheDocument();
  });

  it("renders the section heading (not the dependency note) for a supported domain", () => {
    renderWithProviders(<Reports />, { client: seed([project()], caps({ portfolio: true, benefits: true })) });
    // Section-wrapped Gated reports now render their heading instead of the "not available" note.
    expect(screen.getByRole("heading", { name: /Federated Portfolio \(cross-instance\)/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Benefits Realisation \(pipeline & trajectory\)/i })).toBeInTheDocument();
    // A non-section Gated (Portfolio Health) renders its child report bare — its own heading appears.
    expect(screen.getByText("Portfolio Health")).toBeInTheDocument();
  });

  it("renders the per-project history section and its composed burndown/burnup charts", () => {
    renderWithProviders(<Reports />, { client: seed([project()], caps({ history: true })) });
    // projectId resolves from the seeded project → the history-gated section renders and the
    // IfComposed children mount (uncurated composition ⇒ visible).
    expect(screen.getByRole("heading", { name: /Sprint Burndown/i })).toBeInTheDocument();
  });

  it("hides a section the methodology composition curates out", () => {
    const qc = seed([project()], caps({ portfolio: true }));
    // Only portfolio-rag is composed in — every other reportId-gated section is curated out.
    qc.setQueryData(settingsQueryKey, { methodologyComposition: ["report:portfolio-rag"] });
    renderWithProviders(<Reports />, { client: qc });
    expect(screen.queryByRole("heading", { name: /Federated Portfolio/i })).toBeNull();
    // portfolio-rag (Portfolio Health) stays visible.
    expect(screen.getByText("Portfolio Health")).toBeInTheDocument();
  });
});
