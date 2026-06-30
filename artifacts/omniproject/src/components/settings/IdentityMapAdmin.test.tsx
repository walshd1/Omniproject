import { describe, it, expect, vi, afterEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../test/utils";
import { rateCardQueryKey, identitiesQueryKey, type RateCardConfig, type IdentityMap } from "../../lib/rate-card";
import { IdentityMapAdmin } from "./IdentityMapAdmin";

function card(over: Partial<RateCardConfig> = {}): RateCardConfig {
  return {
    titles: { habc: "Senior Engineer" }, rates: {},
    projectTypes: [{ id: "delivery", label: "Delivery" }],
    uplift: { central: { margin: 0, overhead: 0 }, programme: {}, project: {} },
    ...over,
  };
}

function seed(role: string | undefined, cfg: RateCardConfig | null, ids?: IdentityMap): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity }, mutations: { retry: false } } });
  if (role) qc.setQueryData(["auth", "me"], { sub: "u1", role });
  if (cfg) qc.setQueryData(rateCardQueryKey, cfg);
  qc.setQueryData(identitiesQueryKey, ids ?? { central: { hh: "habc" }, programme: {}, project: {} });
  return qc;
}

afterEach(() => vi.restoreAllMocks());

describe("IdentityMapAdmin", () => {
  it("renders nothing for a non-PMO session", () => {
    renderWithProviders(<IdentityMapAdmin />, { client: seed("manager", card()) });
    expect(screen.queryByTestId("identity-map-admin")).not.toBeInTheDocument();
  });

  it("prompts to define roles first when the card has no titles", () => {
    renderWithProviders(<IdentityMapAdmin />, { client: seed("pmo", card({ titles: {} })) });
    expect(screen.getByTestId("identity-no-roles")).toBeInTheDocument();
  });

  it("shows the central mapping count without revealing names", () => {
    renderWithProviders(<IdentityMapAdmin />, { client: seed("pmo", card()) });
    expect(screen.getByTestId("identity-count")).toHaveTextContent("1 mapping(s)");
  });

  it("saves a plaintext assignee → role; the server hashes the name", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) } as Response);
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<IdentityMapAdmin />, { client: seed("pmo", card()) });

    fireEvent.change(screen.getByLabelText("Assignee 1"), { target: { value: "alice@x.io" } });
    fireEvent.change(screen.getByLabelText("Assignee 1 role"), { target: { value: "habc" } });
    fireEvent.click(screen.getByText("Save mappings"));

    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[0] === "/api/rate-card/identities")).toBe(true));
    const [, init] = fetchMock.mock.calls.find((c) => c[0] === "/api/rate-card/identities")!;
    expect(init.method).toBe("PUT");
    const body = JSON.parse(init.body as string);
    expect(body.level).toBe("central");
    expect(body.assignments).toEqual([{ assignee: "alice@x.io", titleHash: "habc" }]);
  });
});
