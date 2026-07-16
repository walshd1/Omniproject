import { describe, it, expect } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders } from "../test/utils";
import { extensionsKey, type ExtensionMeta } from "../lib/marketplace";
import { Marketplace } from "./Marketplace";

/** The Marketplace page: installed-extension list, empty state, and the install-manifest form (with a
 *  client-side JSON validation guard). */
function seed(extensions: ExtensionMeta[]): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(extensionsKey, extensions);
  return qc;
}
const meta = (over: Partial<ExtensionMeta> = {}): ExtensionMeta => ({
  id: "e1", name: "Reports Pack", publisher: "Acme", version: "1.0.0", status: "installed",
  contributionCount: 2, contributionKinds: ["report", "contentPage"], installedAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", ...over,
});

describe("Marketplace page", () => {
  it("lists installed extensions with their status and contributions", () => {
    renderWithProviders(<Marketplace />, { client: seed([meta(), meta({ id: "e2", name: "Board Pack", status: "disabled" })]) });
    expect(screen.getByTestId("extension-row-e1")).toHaveTextContent("Reports Pack");
    expect(screen.getByTestId("extension-row-e1")).toHaveTextContent("Report");
    expect(screen.getByTestId("extension-row-e2")).toHaveTextContent("disabled");
  });

  it("shows the empty state when nothing is installed", () => {
    renderWithProviders(<Marketplace />, { client: seed([]) });
    expect(screen.getByText(/No extensions installed/i)).toBeInTheDocument();
  });

  it("guards against invalid manifest JSON before calling the server", () => {
    renderWithProviders(<Marketplace />, { client: seed([]) });
    fireEvent.click(screen.getByTestId("extension-install"));
    fireEvent.change(screen.getByTestId("extension-manifest"), { target: { value: "{ not json" } });
    fireEvent.click(screen.getByTestId("extension-install-submit"));
    expect(screen.getByTestId("extension-error")).toHaveTextContent(/valid JSON/i);
  });
});
