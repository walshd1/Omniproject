import { describe, it, expect, vi, afterEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import {
  getListProgrammesQueryKey,
  getListProjectsQueryKey,
} from "@workspace/api-client-react";
import { renderWithProviders } from "../../test/utils";
import { featuresQueryKey, scopeFeatureMapsQueryKey, type FeatureStatus } from "../../lib/features";
import { FEATURE_GATING_CSV_HEADERS } from "../../lib/feature-gating-csv";
import { FeatureGatingBulkAdmin } from "./FeatureGatingBulkAdmin";

function feat(over: Partial<FeatureStatus> = {}): FeatureStatus {
  return { id: "grid", kind: "module", label: "Grid", description: "Editable grid", enabled: true, loaded: true, needsRestart: false, ...over };
}

const CATALOGUE: FeatureStatus[] = [feat(), feat({ id: "presence", label: "Presence" }), feat({ id: "report:evm", label: "Earned Value", kind: "report" })];

function seed(role: string, maps: { programmeFeatures: Record<string, { disabled: string[]; required: string[]; forbidden: string[] }>; projectFeatures: Record<string, { disabled: string[]; required: string[]; forbidden: string[] }> }): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity }, mutations: { retry: false } } });
  qc.setQueryData(["auth", "me"], { authenticated: true, mode: "demo", role, user: { sub: "u", role } });
  qc.setQueryData(getListProgrammesQueryKey(), [{ id: "prog-1", name: "Transformation" }]);
  qc.setQueryData(getListProjectsQueryKey(), [{ id: "p1", name: "Alpha", programmeId: "prog-1" }, { id: "p2", name: "Beta", programmeId: null }]);
  qc.setQueryData(featuresQueryKey({}), CATALOGUE);
  qc.setQueryData(scopeFeatureMapsQueryKey, maps);
  return qc;
}

function fileFor(text: string): File {
  const file = new File([text], "gating.csv", { type: "text/csv" });
  Object.defineProperty(file, "text", { value: () => Promise.resolve(text) });
  return file;
}

const HEADER = FEATURE_GATING_CSV_HEADERS.join(",");

afterEach(() => vi.restoreAllMocks());

describe("FeatureGatingBulkAdmin", () => {
  it("renders nothing for a role that can't manage any scope", () => {
    renderWithProviders(<FeatureGatingBulkAdmin />, { client: seed("viewer", { programmeFeatures: {}, projectFeatures: {} }) });
    expect(screen.queryByTestId("feature-gating-bulk")).not.toBeInTheDocument();
  });

  it("exports a CSV download", () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    vi.stubGlobal("URL", { createObjectURL: () => "blob:x", revokeObjectURL: () => {} });
    renderWithProviders(<FeatureGatingBulkAdmin />, { client: seed("admin", { programmeFeatures: { "prog-1": { disabled: ["grid"], required: [], forbidden: [] } }, projectFeatures: {} }) });
    fireEvent.click(screen.getByTestId("bulk-gating-export"));
    expect(click).toHaveBeenCalled();
  });

  it("previews a diff for an imported CSV, showing only changed rows", async () => {
    renderWithProviders(<FeatureGatingBulkAdmin />, {
      client: seed("admin", { programmeFeatures: { "prog-1": { disabled: ["grid"], required: [], forbidden: [] } }, projectFeatures: {} }),
    });
    const csv = `${HEADER}\nprogramme,prog-1,Transformation,grid,,\nproject,p1,Alpha,,presence,`;
    fireEvent.change(screen.getByTestId("bulk-gating-import-input"), { target: { files: [fileFor(csv)] } });

    await waitFor(() => expect(screen.getByTestId("bulk-gating-preview")).toBeInTheDocument());
    // prog-1 row is identical to current (unchanged) → skipped from the changed table; p1 is new.
    expect(screen.queryByTestId("bulk-gating-row-programme-prog-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("bulk-gating-row-project-p1")).toBeInTheDocument();
    expect(screen.getByTestId("bulk-gating-confirm")).toHaveTextContent("Apply 1 change");
  });

  it("rejects a malformed feature id row with a visible error, but keeps other rows", async () => {
    renderWithProviders(<FeatureGatingBulkAdmin />, { client: seed("admin", { programmeFeatures: {}, projectFeatures: {} }) });
    const csv = `${HEADER}\nprogramme,prog-1,Transformation,not-a-real-id,,\nproject,p1,Alpha,grid,,`;
    fireEvent.change(screen.getByTestId("bulk-gating-import-input"), { target: { files: [fileFor(csv)] } });

    await waitFor(() => expect(screen.getByTestId("bulk-gating-preview")).toBeInTheDocument());
    expect(screen.getByTestId("bulk-gating-errors")).toHaveTextContent(/not-a-real-id/);
    expect(screen.getByTestId("bulk-gating-row-project-p1")).toBeInTheDocument();
  });

  it("warns (non-fatal) on an unrecognised scope id", async () => {
    renderWithProviders(<FeatureGatingBulkAdmin />, { client: seed("admin", { programmeFeatures: {}, projectFeatures: {} }) });
    const csv = `${HEADER}\nprogramme,ghost-prog,Ghost,grid,,`;
    fireEvent.change(screen.getByTestId("bulk-gating-import-input"), { target: { files: [fileFor(csv)] } });

    await waitFor(() => expect(screen.getByTestId("bulk-gating-preview")).toBeInTheDocument());
    expect(screen.getByTestId("bulk-gating-warnings")).toHaveTextContent(/ghost-prog/);
    // still applyable despite the warning
    expect(screen.getByTestId("bulk-gating-row-programme-ghost-prog")).toBeInTheDocument();
  });

  it("applies the previewed changes through the existing per-scope PUT routes, sequentially", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) } as Response);
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<FeatureGatingBulkAdmin />, { client: seed("admin", { programmeFeatures: {}, projectFeatures: {} }) });
    const csv = `${HEADER}\nprogramme,prog-1,Transformation,grid,,\nproject,p1,Alpha,,presence,`;
    fireEvent.change(screen.getByTestId("bulk-gating-import-input"), { target: { files: [fileFor(csv)] } });
    await waitFor(() => expect(screen.getByTestId("bulk-gating-preview")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("bulk-gating-confirm"));
    await waitFor(() => expect(screen.getByTestId("bulk-gating-result")).toBeInTheDocument());

    expect(screen.getByTestId("bulk-gating-result")).toHaveTextContent("2 applied");
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls).toContain("/api/features/programme/prog-1");
    expect(urls.some((u) => u.startsWith("/api/features/project/p1"))).toBe(true);
  });

  it("reports a per-row failure without aborting the whole batch", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes("/programme/")) return Promise.resolve({ ok: false, json: async () => ({ error: "You don't manage this programme." }) } as Response);
      return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<FeatureGatingBulkAdmin />, { client: seed("admin", { programmeFeatures: {}, projectFeatures: {} }) });
    const csv = `${HEADER}\nprogramme,prog-1,Transformation,grid,,\nproject,p1,Alpha,,presence,`;
    fireEvent.change(screen.getByTestId("bulk-gating-import-input"), { target: { files: [fileFor(csv)] } });
    await waitFor(() => expect(screen.getByTestId("bulk-gating-preview")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("bulk-gating-confirm"));
    await waitFor(() => expect(screen.getByTestId("bulk-gating-result")).toBeInTheDocument());
    expect(screen.getByTestId("bulk-gating-result")).toHaveTextContent("1 applied");
    expect(screen.getByTestId("bulk-gating-result")).toHaveTextContent("1 failed");
    expect(screen.getByTestId("bulk-gating-result")).toHaveTextContent(/don't manage this programme/);
  });
});
