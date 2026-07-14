import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, fireEvent, waitFor, renderHook } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { renderWithProviders, mockBlobDownload } from "../../test/utils";
import { guidAliasesQueryKey, type GuidAliases } from "../../lib/guid-aliases";
import { GuidAliasesAdmin } from "./GuidAliasesAdmin";

function seed(role: string | undefined, aliases: GuidAliases): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  if (role) qc.setQueryData(["auth", "me"], { authenticated: true, role, user: { sub: "u1" } });
  qc.setQueryData(guidAliasesQueryKey, aliases);
  return qc;
}

afterEach(() => vi.restoreAllMocks());

describe("GuidAliasesAdmin", () => {
  it("renders nothing below PMO/admin", () => {
    renderWithProviders(<GuidAliasesAdmin />, { client: seed("manager", {}) });
    expect(screen.queryByTestId("guid-aliases-admin")).not.toBeInTheDocument();
  });

  it("disables Save when a relink points a GUID at itself", () => {
    renderWithProviders(<GuidAliasesAdmin />, { client: seed("admin", {}) });
    fireEvent.click(screen.getByTestId("guid-alias-add"));
    fireEvent.change(screen.getByLabelText("Alias 1 old"), { target: { value: "same" } });
    fireEvent.change(screen.getByLabelText("Alias 1 new"), { target: { value: "same" } });
    expect(screen.getByTestId("guid-alias-save")).toBeDisabled();
  });

  it("PUTs a relink to /api/guid-aliases", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    renderWithProviders(<GuidAliasesAdmin />, { client: seed("pmo", {}) });
    fireEvent.click(screen.getByTestId("guid-alias-add"));
    fireEvent.change(screen.getByLabelText("Alias 1 old"), { target: { value: "old" } });
    fireEvent.change(screen.getByLabelText("Alias 1 new"), { target: { value: "new" } });
    fireEvent.click(screen.getByTestId("guid-alias-save"));

    const put = await waitFor(() => {
      const call = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
      expect(call).toBeTruthy();
      return call!;
    });
    expect(String(put[0])).toMatch(/\/guid-aliases$/);
    expect(JSON.parse(String(put[1]?.body)).guidAliases).toEqual({ old: "new" });
  });

  it("forgets a project via DELETE /api/projects/:guid/links", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ guid: "g1", removedFromClosed: true, removedFromProgrammes: [], removedAliases: 0 }), { status: 200 }));
    renderWithProviders(<GuidAliasesAdmin />, { client: seed("admin", {}) });
    fireEvent.change(screen.getByTestId("guid-forget-input"), { target: { value: "g1" } });
    fireEvent.click(screen.getByTestId("guid-forget-btn"));

    const del = await waitFor(() => {
      const call = fetchMock.mock.calls.find(([, init]) => init?.method === "DELETE");
      expect(call).toBeTruthy();
      return call!;
    });
    expect(String(del[0])).toMatch(/\/projects\/g1\/links$/);
  });

  it("seeds the relink table from the server and removes a row", () => {
    renderWithProviders(<GuidAliasesAdmin />, { client: seed("admin", { old1: "new1", old2: "new2" }) });
    expect(screen.getAllByTestId(/^guid-alias-row-/)).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: /remove alias 1/i }));
    const rows = screen.getAllByTestId(/^guid-alias-row-/);
    expect(rows).toHaveLength(1);
    expect(screen.getByLabelText("Alias 1 old")).toHaveValue("old2");
  });

  it("Reset restores the server table after an edit", () => {
    renderWithProviders(<GuidAliasesAdmin />, { client: seed("admin", { a: "b" }) });
    fireEvent.change(screen.getByLabelText("Alias 1 old"), { target: { value: "changed" } });
    expect(screen.getByLabelText("Alias 1 old")).toHaveValue("changed");
    fireEvent.click(screen.getByRole("button", { name: /^reset$/i }));
    expect(screen.getByLabelText("Alias 1 old")).toHaveValue("a");
  });

  it("toasts success after saving relinks", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    const { result } = renderHook(() => useToast());
    renderWithProviders(<GuidAliasesAdmin />, { client: seed("admin", {}) });
    fireEvent.click(screen.getByTestId("guid-alias-add"));
    fireEvent.change(screen.getByLabelText("Alias 1 old"), { target: { value: "old" } });
    fireEvent.change(screen.getByLabelText("Alias 1 new"), { target: { value: "new" } });
    fireEvent.click(screen.getByTestId("guid-alias-save"));
    await waitFor(() => expect(result.current.toasts.some((t) => t.title === "RELINKS SAVED")).toBe(true));
  });

  it("shows a destructive toast when saving relinks fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("bad", { status: 500 }));
    const { result } = renderHook(() => useToast());
    renderWithProviders(<GuidAliasesAdmin />, { client: seed("admin", {}) });
    fireEvent.click(screen.getByTestId("guid-alias-add"));
    fireEvent.change(screen.getByLabelText("Alias 1 old"), { target: { value: "old" } });
    fireEvent.change(screen.getByLabelText("Alias 1 new"), { target: { value: "new" } });
    fireEvent.click(screen.getByTestId("guid-alias-save"));
    await waitFor(() => expect(result.current.toasts.some((t) => t.title === "COULD NOT SAVE" && t.variant === "destructive")).toBe(true));
  });

  it("exports a project's references and toasts success (Export is gated on a GUID)", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response(JSON.stringify({ guid: "g1", closed: null, programmes: [], aliasedFrom: [], aliasTo: null, retired: false }), { status: 200 }),
    );
    const blob = mockBlobDownload();
    const { result } = renderHook(() => useToast());
    try {
      renderWithProviders(<GuidAliasesAdmin />, { client: seed("admin", {}) });
      // Export disabled until a GUID is entered.
      expect(screen.getByTestId("guid-export-btn")).toBeDisabled();
      fireEvent.change(screen.getByTestId("guid-forget-input"), { target: { value: "g1" } });
      expect(screen.getByTestId("guid-export-btn")).not.toBeDisabled();
      fireEvent.click(screen.getByTestId("guid-export-btn"));
      await waitFor(() => expect(result.current.toasts.some((t) => t.title === "EXPORTED")).toBe(true));
      expect(blob.click).toHaveBeenCalled();
    } finally {
      blob.restore();
    }
  });

  it("toasts a failure when the export request errors", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => useToast());
    renderWithProviders(<GuidAliasesAdmin />, { client: seed("admin", {}) });
    fireEvent.change(screen.getByTestId("guid-forget-input"), { target: { value: "g1" } });
    fireEvent.click(screen.getByTestId("guid-export-btn"));
    await waitFor(() => expect(result.current.toasts.some((t) => t.title === "COULD NOT EXPORT" && t.variant === "destructive")).toBe(true));
  });

  it("toasts a failure when forgetting a project errors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 500 }));
    const { result } = renderHook(() => useToast());
    renderWithProviders(<GuidAliasesAdmin />, { client: seed("admin", {}) });
    fireEvent.change(screen.getByTestId("guid-forget-input"), { target: { value: "g1" } });
    fireEvent.click(screen.getByTestId("guid-forget-btn"));
    await waitFor(() => expect(result.current.toasts.some((t) => t.title === "COULD NOT FORGET" && t.variant === "destructive")).toBe(true));
  });

  it("reports the programmes and closed-index a forget unlinked in the success toast", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response(JSON.stringify({ guid: "g1", removedFromClosed: true, removedFromProgrammes: ["P1", "P2"], removedAliases: 0 }), { status: 200 }),
    );
    const { result } = renderHook(() => useToast());
    renderWithProviders(<GuidAliasesAdmin />, { client: seed("admin", {}) });
    const input = screen.getByTestId("guid-forget-input");
    fireEvent.change(input, { target: { value: "g1" } });
    fireEvent.click(screen.getByTestId("guid-forget-btn"));
    await waitFor(() => {
      const t = result.current.toasts.find((x) => x.title === "PROJECT FORGOTTEN");
      expect(t).toBeTruthy();
      expect(String(t!.description)).toMatch(/2 programme\(s\).*closed index/);
    });
    // The GUID field is cleared on success.
    expect(input).toHaveValue("");
  });
});
