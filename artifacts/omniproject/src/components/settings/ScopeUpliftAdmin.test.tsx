import { describe, it, expect, vi, afterEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../test/utils";
import { rateCardQueryKey, type RateCardConfig } from "../../lib/rate-card";
import { ScopeUpliftAdmin } from "./ScopeUpliftAdmin";

function card(over: Partial<RateCardConfig["uplift"]> = {}): RateCardConfig {
  return {
    titles: {}, rates: {}, projectTypes: [],
    uplift: { central: { margin: 0.2, overhead: 0.1 }, programme: {}, project: {}, ...over },
  };
}

function seed(role: string | undefined, cfg: RateCardConfig): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity }, mutations: { retry: false } } });
  if (role) qc.setQueryData(["auth", "me"], { sub: "u1", role });
  qc.setQueryData(rateCardQueryKey, cfg);
  return qc;
}

afterEach(() => vi.restoreAllMocks());

describe("ScopeUpliftAdmin", () => {
  it("renders nothing for a non-PMO session", () => {
    renderWithProviders(<ScopeUpliftAdmin />, { client: seed("manager", card()) });
    expect(screen.queryByTestId("scope-uplift-admin")).not.toBeInTheDocument();
  });

  it("lists existing overrides, showing inherited fields as central", () => {
    renderWithProviders(<ScopeUpliftAdmin />, { client: seed("pmo", card({ programme: { "prog-1": { margin: 0.3 } } })) });
    const row = screen.getByTestId("scope-uplift-row-programme-prog-1");
    expect(row).toHaveTextContent("30%"); // margin override
    expect(row).toHaveTextContent("central"); // overhead inherits
  });

  it("applies a programme margin override via the per-scope endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) } as Response);
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<ScopeUpliftAdmin />, { client: seed("pmo", card()) });

    fireEvent.change(screen.getByLabelText("Override scope id"), { target: { value: "prog-9" } });
    fireEvent.change(screen.getByLabelText("Override margin %"), { target: { value: "35" } });
    fireEvent.click(screen.getByText("Apply override"));

    await waitFor(() => expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/rate-card/uplift/"))).toBe(true));
    const [url, init] = fetchMock.mock.calls.find((c) => String(c[0]).includes("/rate-card/uplift/"))!;
    expect(url).toBe("/api/rate-card/uplift/programme/prog-9");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({ margin: 0.35 }); // overhead omitted → inherits central
  });

  it("clears an override by PUTting an empty body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) } as Response);
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<ScopeUpliftAdmin />, { client: seed("pmo", card({ project: { "proj-1": { overhead: 0.05 } } })) });

    fireEvent.click(screen.getByLabelText("Clear project proj-1 override"));
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[0] === "/api/rate-card/uplift/project/proj-1")).toBe(true));
    const [, init] = fetchMock.mock.calls.find((c) => c[0] === "/api/rate-card/uplift/project/proj-1")!;
    expect(JSON.parse(init.body as string)).toEqual({});
  });
});
