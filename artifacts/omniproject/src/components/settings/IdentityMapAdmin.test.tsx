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

  it("removing a middle assignee row keeps the other rows' entered names (stable row keys)", () => {
    renderWithProviders(<IdentityMapAdmin />, { client: seed("pmo", card()) });

    fireEvent.change(screen.getByLabelText("Assignee 1"), { target: { value: "alice" } });
    fireEvent.click(screen.getByText("+ assignee"));
    fireEvent.change(screen.getByLabelText("Assignee 2"), { target: { value: "bob" } });
    fireEvent.click(screen.getByText("+ assignee"));
    fireEvent.change(screen.getByLabelText("Assignee 3"), { target: { value: "carol" } });

    // Remove the middle row (bob) — alice and carol must remain.
    fireEvent.click(screen.getByLabelText("Remove assignment row 2"));

    const inputs = screen.getAllByLabelText(/^Assignee \d+$/);
    expect(inputs.map((el) => (el as HTMLInputElement).value)).toEqual(["alice", "carol"]);
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

  it("renders nothing while the rate card is still loading (no card yet)", () => {
    renderWithProviders(<IdentityMapAdmin />, { client: seed("pmo", null) });
    expect(screen.queryByTestId("identity-map-admin")).not.toBeInTheDocument();
  });

  it("prompts for a scope id at programme level and counts that scope's mappings only", () => {
    const ids = { central: { hh: "habc" }, programme: { "prog-1": { a: "habc", b: "habc" } }, project: {} };
    renderWithProviders(<IdentityMapAdmin />, { client: seed("pmo", card(), ids) });

    fireEvent.change(screen.getByLabelText("Identity map scope level"), { target: { value: "programme" } });
    // Before an id is entered the count prompts for one…
    expect(screen.getByTestId("identity-count")).toHaveTextContent("enter a scope id");
    // Save is blocked without a scope id even with an assignee.
    fireEvent.change(screen.getByLabelText("Assignee 1"), { target: { value: "alice" } });
    expect(screen.getByText("Save mappings")).toBeDisabled();
    // …then it counts only that programme's existing mappings.
    fireEvent.change(screen.getByLabelText("Scope id"), { target: { value: "prog-1" } });
    expect(screen.getByTestId("identity-count")).toHaveTextContent("2 mapping(s)");
  });

  it("saves a programme-scoped mapping with its scope id, then clears the rows on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) } as Response);
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<IdentityMapAdmin />, { client: seed("pmo", card()) });

    fireEvent.change(screen.getByLabelText("Identity map scope level"), { target: { value: "programme" } });
    fireEvent.change(screen.getByLabelText("Scope id"), { target: { value: "prog-1" } });
    fireEvent.change(screen.getByLabelText("Assignee 1"), { target: { value: "bob" } });
    fireEvent.click(screen.getByText("Save mappings"));

    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[0] === "/api/rate-card/identities")).toBe(true));
    const [, init] = fetchMock.mock.calls.find((c) => c[0] === "/api/rate-card/identities")!;
    const body = JSON.parse(init.body as string);
    expect(body.level).toBe("programme");
    expect(body.scopeId).toBe("prog-1");
    // onSuccess resets to a single blank row.
    await waitFor(() => expect((screen.getByLabelText("Assignee 1") as HTMLInputElement).value).toBe(""));
    expect(screen.getByText("Saved (names hashed).")).toBeInTheDocument();
  });

  it("surfaces a save error in an alert", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: "unknown title hash" }) } as Response);
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<IdentityMapAdmin />, { client: seed("pmo", card()) });

    fireEvent.change(screen.getByLabelText("Assignee 1"), { target: { value: "carol" } });
    fireEvent.click(screen.getByText("Save mappings"));
    expect(await screen.findByRole("alert")).toHaveTextContent("unknown title hash");
  });

  it("counts zero at central when the identity map has no central bucket, and edits a second row's role", () => {
    const ids = { central: undefined as unknown as Record<string, string>, programme: {}, project: {} };
    renderWithProviders(<IdentityMapAdmin />, { client: seed("pmo", card(), ids) });
    expect(screen.getByTestId("identity-count")).toHaveTextContent("0 mapping(s)");
    // Add a second row and set its role — exercises the per-row map update on a non-first row.
    fireEvent.click(screen.getByText("+ assignee"));
    fireEvent.change(screen.getByLabelText("Assignee 2 role"), { target: { value: "habc" } });
    expect((screen.getByLabelText("Assignee 2 role") as HTMLSelectElement).value).toBe("habc");
    // Row 1's role stays untouched.
    expect((screen.getByLabelText("Assignee 1 role") as HTMLSelectElement).value).toBe("");
  });

  it("removing the last remaining row leaves a single blank row instead of an empty editor", () => {
    renderWithProviders(<IdentityMapAdmin />, { client: seed("pmo", card()) });
    fireEvent.change(screen.getByLabelText("Assignee 1"), { target: { value: "dave" } });
    fireEvent.click(screen.getByLabelText("Remove assignment row 1"));
    const inputs = screen.getAllByLabelText(/^Assignee \d+$/);
    expect(inputs).toHaveLength(1);
    expect((inputs[0] as HTMLInputElement).value).toBe("");
  });
});
