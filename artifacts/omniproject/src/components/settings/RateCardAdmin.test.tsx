import { describe, it, expect, vi, afterEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../test/utils";
import { rateCardQueryKey, type RateCardConfig } from "../../lib/rate-card";
import { RateCardAdmin } from "./RateCardAdmin";

function config(over: Partial<RateCardConfig> = {}): RateCardConfig {
  return {
    titles: {}, rates: {},
    projectTypes: [{ id: "delivery", label: "Delivery", values: [{ id: "cost", label: "True cost", kind: "cost" }] }],
    uplift: { central: { margin: 0.2, overhead: 0.1 }, programme: {}, project: {} },
    ...over,
  };
}

function seed(role: string | undefined, cfg: RateCardConfig | null): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity }, mutations: { retry: false } } });
  if (role) qc.setQueryData(["auth", "me"], { sub: "u1", role });
  if (cfg) qc.setQueryData(rateCardQueryKey, cfg);
  return qc;
}

afterEach(() => vi.restoreAllMocks());

describe("RateCardAdmin", () => {
  it("renders nothing for a non-PMO session", () => {
    renderWithProviders(<RateCardAdmin />, { client: seed("manager", config()) });
    expect(screen.queryByTestId("rate-card-admin")).not.toBeInTheDocument();
  });

  it("seeds the central uplift and project types from the server", () => {
    renderWithProviders(<RateCardAdmin />, { client: seed("pmo", config()) });
    expect(screen.getByTestId("rate-card-admin")).toBeInTheDocument();
    expect(screen.getByLabelText("Central margin %")).toHaveValue(20); // 0.2 → 20%
    expect(screen.getByTestId("rate-card-type-0")).toBeInTheDocument();
    expect(screen.getByTestId("rate-card-col-0-0")).toBeInTheDocument();
  });

  it("adds a project type and a value column in the draft", () => {
    renderWithProviders(<RateCardAdmin />, { client: seed("pmo", config()) });
    fireEvent.click(screen.getByText("+ project type"));
    expect(screen.getByTestId("rate-card-type-1")).toBeInTheDocument();
    fireEvent.click(screen.getAllByText("+ value column")[1]!); // on the new type
    expect(screen.getByTestId("rate-card-col-1-0")).toBeInTheDocument();
  });

  it("saves the edited margin and round-trips the untouched titles/rates", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => config() } as Response);
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<RateCardAdmin />, { client: seed("pmo", config({ titles: { h1: "Engineer" } })) });

    fireEvent.change(screen.getByLabelText("Central margin %"), { target: { value: "25" } });
    fireEvent.click(screen.getByText("Save rate card"));

    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[0] === "/api/rate-card")).toBe(true));
    const [, init] = fetchMock.mock.calls.find((c) => c[0] === "/api/rate-card")!;
    expect(init.method).toBe("PUT");
    const body = JSON.parse(init.body as string);
    expect(body.uplift.margin).toBeCloseTo(0.25);
    expect(body.titles).toEqual({ h1: "Engineer" }); // untouched parts round-tripped
  });
});
