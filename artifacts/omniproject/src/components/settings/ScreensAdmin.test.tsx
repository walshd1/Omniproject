import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders } from "../../test/utils";
import { settingsQueryKey } from "../../lib/settings-query";
import { ScreensAdmin } from "./ScreensAdmin";

function seed(role: string | undefined, org: unknown[] = [], disabled: string[] = []): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  if (role) qc.setQueryData(["auth", "me"], { authenticated: true, role, user: { sub: "u1" } });
  // Screen defs + disabled screens are slices of the one shared /api/settings read.
  qc.setQueryData(settingsQueryKey, { screenDefs: org, disabledScreens: disabled });
  return qc;
}

afterEach(() => vi.restoreAllMocks());

describe("ScreensAdmin", () => {
  it("renders nothing below admin/PMO", () => {
    renderWithProviders(<ScreensAdmin />, { client: seed("manager") });
    expect(screen.queryByTestId("screens-admin")).not.toBeInTheDocument();
  });

  it("lists screens and marks org-overridden ones", () => {
    const org = [{ id: "kanban", label: "Team Board", panels: [{ id: "b", kind: "view" }] }];
    renderWithProviders(<ScreensAdmin />, { client: seed("pmo", org) });
    expect(screen.getByTestId("screens-admin")).toBeInTheDocument();
    expect(screen.getByTestId("screen-row-budget-plans")).toBeInTheDocument();
    expect(screen.getByTestId("screen-overridden-kanban")).toBeInTheDocument(); // badge
  });

  it("turning a screen off PUTs the disabled list", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    renderWithProviders(<ScreensAdmin />, { client: seed("admin") });
    fireEvent.click(screen.getByTestId("screen-toggle-kanban")); // was On → turn Off
    const put = await waitFor(() => {
      const call = fetchMock.mock.calls.find(([u, i]) => u === "/api/disabled-screens" && (i as RequestInit)?.method === "PUT");
      expect(call).toBeTruthy();
      return call!;
    });
    const body = JSON.parse((put[1] as RequestInit).body as string) as { disabledScreens: string[] };
    expect(body.disabledScreens).toContain("kanban");
  });

  it("customising via the structured editor PUTs the def into the org screen defs (id pinned)", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    renderWithProviders(<ScreensAdmin />, { client: seed("pmo") });
    fireEvent.click(screen.getByTestId("screen-edit-kanban"));
    expect(screen.getByTestId("screen-editor")).toBeInTheDocument(); // structured editor, not a raw textarea
    fireEvent.change(screen.getByTestId("screen-editor-label"), { target: { value: "Custom Kanban" } });
    fireEvent.click(screen.getByTestId("screen-editor-save"));
    const put = await waitFor(() => {
      const call = fetchMock.mock.calls.find(([u, i]) => u === "/api/screen-defs" && (i as RequestInit)?.method === "PUT");
      expect(call).toBeTruthy();
      return call!;
    });
    const body = JSON.parse((put[1] as RequestInit).body as string) as { screenDefs: { id: string; label: string }[] };
    const kanban = body.screenDefs.find((s) => s.id === "kanban")!;
    expect(kanban.label).toBe("Custom Kanban");
    expect(kanban.id).toBe("kanban"); // pinned — the editor can't retarget the override
  });

  it("a core screen shows the Core badge and no on/off toggle", () => {
    renderWithProviders(<ScreensAdmin />, { client: seed("admin") });
    expect(screen.getByTestId("screen-core-home")).toBeInTheDocument();
    expect(screen.queryByTestId("screen-toggle-home")).toBeNull(); // can't be turned off
    expect(screen.getByTestId("screen-edit-home")).toBeInTheDocument(); // …but can be customised
  });
});
