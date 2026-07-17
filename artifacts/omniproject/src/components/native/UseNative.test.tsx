import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders, mockFetchRouter, resetFetchMock } from "../../test/utils";
import { nativeSurfacesKey, type NativeSurface } from "../../lib/native";
import { UseNative } from "./UseNative";

/**
 * The `<UseNative>` companion-app bridge (roadmap X.1). It's purely surface-driven: it renders a vendor
 * button only when a connected backend advertises a surface for the given `kind`, hands off through the
 * broker (opening the minted URL), then offers to bring the reference back as an attachment.
 */
const WHITEBOARD: NativeSurface = {
  kind: "whiteboard", vendor: "demoboard", label: "Demoboard",
  actions: ["open", "create"], importMode: "reference",
};

function seeded(surfaces: NativeSurface[]): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  qc.setQueryData(nativeSurfacesKey, surfaces);
  return qc;
}

afterEach(resetFetchMock);

describe("UseNative", () => {
  it("renders nothing when no surface fronts this kind", () => {
    const { container } = renderWithProviders(<UseNative kind="whiteboard" />, { client: seeded([]) });
    expect(container.querySelector('[data-testid="use-native"]')).toBeNull();
    // A surface of a different kind must not match either.
    const other = { ...WHITEBOARD, kind: "document" as const };
    renderWithProviders(<UseNative kind="whiteboard" />, { client: seeded([other]) });
    expect(screen.queryByTestId("use-native-demoboard")).toBeNull();
  });

  it("renders one button per matching vendor surface", () => {
    renderWithProviders(<UseNative kind="whiteboard" />, { client: seeded([WHITEBOARD]) });
    const btn = screen.getByTestId("use-native-demoboard");
    expect(btn).toHaveTextContent("Demoboard");
  });

  it("hands off, then offers to attach the reference back on the anchoring project", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    mockFetchRouter({
      "/api/native/handoff": { ok: true, body: { url: "https://example.com/omni/whiteboard/new", handoffId: "h1" } },
      "/api/native/import": { ok: true, status: 201, body: { filename: "demoboard:whiteboard", url: "https://example.com/omni/whiteboard/new" } },
    });
    renderWithProviders(<UseNative kind="whiteboard" contextRef={{ projectId: "proj-001" }} />, { client: seeded([WHITEBOARD]) });

    // Before handoff there's no attach affordance.
    expect(screen.queryByTestId("use-native-attach")).toBeNull();
    fireEvent.click(screen.getByTestId("use-native-demoboard"));

    // Handoff opens the minted URL in the user's own browser, then the attach button appears.
    await waitFor(() => expect(open).toHaveBeenCalledWith("https://example.com/omni/whiteboard/new", "_blank", "noopener,noreferrer"));
    const attach = await screen.findByTestId("use-native-attach");
    fireEvent.click(attach);
    await waitFor(() => expect(screen.queryByTestId("use-native-attach")).toBeNull());
    open.mockRestore();
  });

  it("offers no attach button without a project context to anchor to", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    mockFetchRouter({ "/api/native/handoff": { ok: true, body: { url: "https://example.com/omni/whiteboard/new", handoffId: "h1" } } });
    renderWithProviders(<UseNative kind="whiteboard" />, { client: seeded([WHITEBOARD]) });
    fireEvent.click(screen.getByTestId("use-native-demoboard"));
    await waitFor(() => expect(open).toHaveBeenCalled());
    expect(screen.queryByTestId("use-native-attach")).toBeNull();
    open.mockRestore();
  });
});
