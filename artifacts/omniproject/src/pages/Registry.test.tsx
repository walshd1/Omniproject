import { describe, it, expect } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders } from "../test/utils";
import type { Role } from "../lib/auth";
import {
  registryKey, referenceDesignsKey, communityStatusKey,
  type RegistryItemMeta, type ReferenceDesign, type CommunityStatus,
} from "../lib/registry";
import { Registry } from "./Registry";

/** The Registry page: item list, admin review queue, reference panel, and the submit form's JSON guard. */
function seed(opts: { items?: RegistryItemMeta[]; role?: Role; designs?: ReferenceDesign[]; community?: CommunityStatus } = {}): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(["auth", "me"], { authenticated: true, role: opts.role ?? "admin", user: { sub: "u1" } });
  qc.setQueryData(registryKey, opts.items ?? []);
  qc.setQueryData(referenceDesignsKey, opts.designs ?? []);
  qc.setQueryData(communityStatusKey, opts.community ?? { connected: false, name: null });
  return qc;
}
const item = (over: Partial<RegistryItemMeta> = {}): RegistryItemMeta => ({
  id: "r1", kind: "report", name: "Burn rate", publisher: "Acme", version: "1.0.0",
  approvalStatus: "draft", visibility: "internal", tags: ["finance"],
  submittedBy: "cee@x.io", submittedAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", ...over,
});
const design: ReferenceDesign = {
  slug: "grouped-column", title: "A visualisation primitive", kind: "primitive",
  summary: "Add a new chart type as pure JSON.", notes: ["…"],
  example: { kind: "primitive", name: "Grouped column chart", publisher: "Acme", version: "1.0.0", description: "", tags: [], payload: { id: "grouped-column" } },
};

describe("Registry page", () => {
  it("lists items with status and kind, and shows an admin review queue for drafts", () => {
    renderWithProviders(<Registry />, { client: seed({ items: [item(), item({ id: "r2", name: "Roadmap screen", kind: "screen", approvalStatus: "approved" })] }) });
    expect(screen.getByTestId("registry-row-r1")).toHaveTextContent("Burn rate");
    expect(screen.getByTestId("registry-row-r1")).toHaveTextContent("draft");
    // A draft appears in the admin review queue with approve/reject controls.
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

  it("lists reference designs and guards invalid submission JSON before calling the server", () => {
    renderWithProviders(<Registry />, { client: seed({ designs: [design] }) });
    expect(screen.getByTestId("reference-list")).toHaveTextContent("A visualisation primitive");
    fireEvent.click(screen.getByTestId("registry-new"));
    fireEvent.change(screen.getByTestId("registry-submission"), { target: { value: "{ not json" } });
    fireEvent.click(screen.getByTestId("registry-submit"));
    expect(screen.getByTestId("registry-error")).toHaveTextContent(/valid JSON/i);
  });

  it("prefills the submit form from a reference design", () => {
    renderWithProviders(<Registry />, { client: seed({ designs: [design] }) });
    fireEvent.click(screen.getByTestId("reference-use-grouped-column"));
    const box = screen.getByTestId("registry-submission") as HTMLTextAreaElement;
    expect(box.value).toContain("Grouped column chart");
  });

  it("shows the empty state when there are no items", () => {
    renderWithProviders(<Registry />, { client: seed({ items: [] }) });
    expect(screen.getByText(/No registry items yet/i)).toBeInTheDocument();
  });
});
