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

  it("adds a role, edits its title, and drops emptied rate cells on save", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => config() } as Response);
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<RateGridAdmin />, { client: seed("pmo", config()) });

    fireEvent.click(screen.getByText("+ role"));
    fireEvent.change(screen.getByLabelText("Role 2 title"), { target: { value: "Analyst" } });
    // Set then clear the new role's rate — clearing the last cell drops the whole type key.
    fireEvent.change(screen.getByLabelText("Analyst Delivery client rate"), { target: { value: "70" } });
    fireEvent.change(screen.getByLabelText("Analyst Delivery client rate"), { target: { value: "" } });
    fireEvent.click(screen.getByText("Save rates"));

    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[0] === "/api/rate-card")).toBe(true));
    const [, init] = fetchMock.mock.calls.find((c) => c[0] === "/api/rate-card")!;
    const body = JSON.parse(init.body as string);
    expect(body.roles).toEqual([
      { title: "Senior Engineer", rates: { delivery: { client: 120, internal: 90 } } },
      { title: "Analyst", rates: {} },
    ]);
  });

  it("ignores a negative rate (cell is cleared, not stored)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => config() } as Response);
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<RateGridAdmin />, { client: seed("pmo", config()) });

    fireEvent.change(screen.getByLabelText("Senior Engineer Delivery client rate"), { target: { value: "-5" } });
    fireEvent.click(screen.getByText("Save rates"));

    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[0] === "/api/rate-card")).toBe(true));
    const [, init] = fetchMock.mock.calls.find((c) => c[0] === "/api/rate-card")!;
    const body = JSON.parse(init.body as string);
    expect(body.roles[0].rates.delivery).toEqual({ internal: 90 }); // client cleared by the negative
  });

  it("removes a role row and resets the draft back to the server copy", () => {
    renderWithProviders(<RateGridAdmin />, { client: seed("pmo", config()) });
    // Edit → the Reset control appears; Reset restores the seeded value.
    const title = screen.getByLabelText("Role 1 title");
    fireEvent.change(title, { target: { value: "Changed" } });
    fireEvent.click(screen.getByText("Reset"));
    expect(screen.getByLabelText("Role 1 title")).toHaveValue("Senior Engineer");

    fireEvent.click(screen.getByLabelText("Remove role 1"));
    expect(screen.getByTestId("rate-grid-empty")).toBeInTheDocument();
  });

  it("surfaces a save error inline", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false, status: 500, statusText: "Error",
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ error: "Server exploded" }),
      text: async () => JSON.stringify({ error: "Server exploded" }),
    } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<RateGridAdmin />, { client: seed("pmo", config()) });

    fireEvent.change(screen.getByLabelText("Senior Engineer Delivery internal rate"), { target: { value: "95" } });
    fireEvent.click(screen.getByText("Save rates"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Server exploded");
  });
});
