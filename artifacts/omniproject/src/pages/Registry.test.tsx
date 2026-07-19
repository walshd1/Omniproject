import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders } from "../test/utils";
import type { Role } from "../lib/auth";
import { registryKey, communityStatusKey, type RegistryItemMeta, type CommunityStatus } from "../lib/registry";
import { Registry } from "./Registry";
import * as api from "../lib/api";

/** The Registry page: item list, admin review queue, release control, and the submit form's JSON guard. */
function seed(opts: { items?: RegistryItemMeta[]; role?: Role; community?: CommunityStatus } = {}): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(["auth", "me"], { authenticated: true, role: opts.role ?? "admin", user: { sub: "u1" } });
  qc.setQueryData(registryKey, opts.items ?? []);
  qc.setQueryData(communityStatusKey, opts.community ?? { connected: false, name: null });
  return qc;
}
const item = (over: Partial<RegistryItemMeta> = {}): RegistryItemMeta => ({
  id: "r1", kind: "report", name: "Burn rate", publisher: "Acme", version: "1.0.0",
  approvalStatus: "draft", visibility: "internal", tags: ["finance"],
  submittedBy: "cee@x.io", submittedAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", ...over,
});

describe("Registry page", () => {
  it("lists items with status and kind, and shows an admin review queue for drafts", () => {
    renderWithProviders(<Registry />, { client: seed({ items: [item(), item({ id: "r2", name: "Roadmap screen", kind: "screen", approvalStatus: "approved" })] }) });
    expect(screen.getByTestId("registry-row-r1")).toHaveTextContent("Burn rate");
    expect(screen.getByTestId("registry-row-r1")).toHaveTextContent("draft");
    expect(screen.getByTestId("registry-review-queue")).toBeInTheDocument();
    expect(screen.getByTestId("registry-approve-r1")).toBeInTheDocument();
    expect(screen.getByTestId("registry-reject-r1")).toBeInTheDocument();
  });

  it("shows the community status and, for an approved item, a release control", () => {
    renderWithProviders(<Registry />, { client: seed({ items: [item({ approvalStatus: "approved" })], community: { connected: false, name: null } }) });
    expect(screen.getByTestId("community-status")).toHaveTextContent(/not connected/i);
    expect(screen.getByTestId("registry-release-r1")).toBeInTheDocument();
  });

  it("hides admin controls from a non-admin", () => {
    renderWithProviders(<Registry />, { client: seed({ role: "contributor", items: [item()] }) });
    expect(screen.queryByTestId("registry-approve-r1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("registry-review-queue")).not.toBeInTheDocument();
  });

  it("points authors at the repo reference-designs skeletons and guards invalid submission JSON", () => {
    renderWithProviders(<Registry />, { client: seed({}) });
    expect(screen.getByTestId("reference-hint")).toHaveTextContent(/reference-designs/i);
    fireEvent.click(screen.getByTestId("registry-new"));
    fireEvent.change(screen.getByTestId("registry-submission"), { target: { value: "{ not json" } });
    fireEvent.click(screen.getByTestId("registry-submit"));
    expect(screen.getByTestId("registry-error")).toHaveTextContent(/valid JSON/i);
  });

  it("shows the empty state when there are no items", () => {
    renderWithProviders(<Registry />, { client: seed({ items: [] }) });
    expect(screen.getByText(/No registry items yet/i)).toBeInTheDocument();
  });

  describe("per-scope primitive approval", () => {
    afterEach(() => vi.restoreAllMocks());

    it("shows a scope picker ONLY for a primitive draft, and approves into the chosen project", async () => {
      const sendJson = vi.spyOn(api, "sendJson").mockResolvedValue({});
      renderWithProviders(<Registry />, { client: seed({ items: [
        item({ id: "p1", name: "Acme tile", kind: "primitive" }),
        item({ id: "r1", name: "Burn rate", kind: "report" }),
      ] }) });
      // The report draft has no scope picker; the primitive draft does.
      expect(screen.queryByTestId("registry-scope-picker-r1")).not.toBeInTheDocument();
      expect(screen.getByTestId("registry-scope-picker-p1")).toBeInTheDocument();
      // Org-wide by default: no id field, approve enabled.
      expect(screen.queryByTestId("registry-scope-id-p1")).not.toBeInTheDocument();
      // Choose project → an id field appears; approve is gated until it's filled.
      fireEvent.change(screen.getByTestId("registry-scope-p1"), { target: { value: "project" } });
      expect(screen.getByTestId("registry-approve-p1")).toBeDisabled();
      fireEvent.change(screen.getByTestId("registry-scope-id-p1"), { target: { value: "proj-x" } });
      fireEvent.click(screen.getByTestId("registry-approve-p1"));
      await waitFor(() => expect(sendJson).toHaveBeenCalledWith(
        "/api/registry/p1/review",
        expect.objectContaining({ decision: "approved", scope: "project", projectId: "proj-x" }),
        "POST",
      ));
    });

    it("approves a primitive org-wide with no scope in the body", async () => {
      const sendJson = vi.spyOn(api, "sendJson").mockResolvedValue({});
      renderWithProviders(<Registry />, { client: seed({ items: [item({ id: "p1", name: "Acme tile", kind: "primitive" })] }) });
      fireEvent.click(screen.getByTestId("registry-approve-p1"));
      await waitFor(() => expect(sendJson).toHaveBeenCalledWith("/api/registry/p1/review", { decision: "approved" }, "POST"));
    });

    it("badges an approved primitive with the scope it was activated into", () => {
      renderWithProviders(<Registry />, { client: seed({ items: [
        item({ id: "p1", name: "Acme tile", kind: "primitive", approvalStatus: "approved", activatedScope: { kind: "project", projectId: "proj-x" } }),
      ] }) });
      expect(screen.getByTestId("registry-activated-scope-p1")).toHaveTextContent(/Project proj-x/i);
    });
  });
});
