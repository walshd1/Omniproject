import { describe, it, expect, vi, afterEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../test/utils";
import { rateCardQueryKey, type RateCardConfig } from "../../lib/rate-card";
import { RateGridAdmin } from "./RateGridAdmin";

function config(over: Partial<RateCardConfig> = {}): RateCardConfig {
  return {
    titles: { habc: "Senior Engineer" },
    rates: { habc: { delivery: { client: 120, internal: 90 } } },
    projectTypes: [{ id: "delivery", label: "Delivery" }],
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

describe("RateGridAdmin", () => {
  it("renders nothing for a non-PMO session", () => {
    renderWithProviders(<RateGridAdmin />, { client: seed("manager", config()) });
    expect(screen.queryByTestId("rate-grid-admin")).not.toBeInTheDocument();
  });

  it("prompts to define a project type when none exist", () => {
    renderWithProviders(<RateGridAdmin />, { client: seed("pmo", config({ projectTypes: [] })) });
    expect(screen.getByTestId("rate-grid-no-types")).toBeInTheDocument();
  });

  it("renders a role row with the existing rate seeded", () => {
    renderWithProviders(<RateGridAdmin />, { client: seed("pmo", config()) });
    expect(screen.getByTestId("rate-grid-row-0")).toBeInTheDocument();
    expect(screen.getByLabelText("Senior Engineer Delivery client rate")).toHaveValue(120);
  });

  it("saves edited rates as plaintext roles (server hashes the title)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => config() } as Response);
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<RateGridAdmin />, { client: seed("pmo", config()) });

    fireEvent.change(screen.getByLabelText("Senior Engineer Delivery internal rate"), { target: { value: "95" } });
    fireEvent.click(screen.getByText("Save rates"));

    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[0] === "/api/rate-card")).toBe(true));
    const [, init] = fetchMock.mock.calls.find((c) => c[0] === "/api/rate-card")!;
    const body = JSON.parse(init.body as string);
    expect(body.roles).toEqual([{ title: "Senior Engineer", rates: { delivery: { client: 120, internal: 95 } } }]);
    expect(body.projectTypes).toEqual(config().projectTypes); // round-tripped
  });
});
