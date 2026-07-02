import { describe, it, expect } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { screen } from "@testing-library/react";
import { getListProjectsQueryKey, type Project } from "@workspace/api-client-react";
import { renderWithProviders } from "../test/utils";
import { ContentPages } from "./ContentPages";
import { featuresQueryKey, type FeatureStatus } from "../lib/features";
import { contentPagesQueryKey } from "../lib/content-pages";
import type { ContentPageDef } from "../lib/content-pages";

function seed(opts: { enabled?: boolean; pages?: ContentPageDef[]; projects?: Project[] } = {}): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  qc.setQueryData(featuresQueryKey(), [
    { id: "contentPages", kind: "module", label: "Content pages", description: "", enabled: opts.enabled ?? true, loaded: true, needsRestart: false },
  ] satisfies FeatureStatus[]);
  qc.setQueryData(contentPagesQueryKey, opts.pages ?? []);
  qc.setQueryData(getListProjectsQueryKey(), opts.projects ?? []);
  return qc;
}

describe("ContentPages", () => {
  it("shows the not-enabled note when the module is off", () => {
    renderWithProviders(<ContentPages />, { client: seed({ enabled: false }) });
    expect(screen.getByText(/module is not enabled/i)).toBeInTheDocument();
  });

  it("shows the empty state when there are no content pages", () => {
    renderWithProviders(<ContentPages />, { client: seed({ pages: [] }) });
    expect(screen.getByTestId("content-pages-empty")).toBeInTheDocument();
  });

  it("shows a page's own empty state when it has no components", () => {
    const page: ContentPageDef = { id: "p1", name: "Empty page", componentIds: [] };
    renderWithProviders(<ContentPages />, { client: seed({ pages: [page] }) });
    expect(screen.getByTestId("content-page-empty")).toBeInTheDocument();
  });

  it("renders the active page's components in order", () => {
    const page: ContentPageDef = { id: "p1", name: "Exec view", componentIds: ["widget:projectCount", "widget:programmeCount"] };
    renderWithProviders(<ContentPages />, { client: seed({ pages: [page], projects: [{ id: "a" } as Project] }) });
    expect(screen.getByTestId("content-page-grid")).toBeInTheDocument();
    expect(screen.getByText("Project count")).toBeInTheDocument(); // section heading (catalogue label)
    expect(screen.getByText("Projects")).toBeInTheDocument(); // the widget's own rendered stat
    expect(screen.getByText("Programme count")).toBeInTheDocument();
  });

  it("renders a placeholder for a removed/unknown component id", () => {
    const page: ContentPageDef = { id: "p1", name: "Legacy", componentIds: ["widget:goneWidget"] };
    renderWithProviders(<ContentPages />, { client: seed({ pages: [page] }) });
    expect(screen.getByTestId("content-page-unknown-widget:goneWidget")).toBeInTheDocument();
  });
});
