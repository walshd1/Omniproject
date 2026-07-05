import { describe, it, expect, afterEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders, mockFetchRouter, resetFetchMock } from "../test/utils";
import { MessyDataControl } from "./MessyDataControl";

/**
 * The messy-data control renders only on a dev instance and reflects the current
 * config (on/off, intensity, seed) plus the gremlin catalogue.
 */
function client(seed: Record<string, unknown>): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  for (const [k, v] of Object.entries(seed)) qc.setQueryData([k], v);
  return qc;
}

const messyState = {
  config: { on: true, seed: "omni", intensity: 0.4, gremlins: [] as string[] },
  gremlins: [
    { id: "nullify", label: "Null values", description: "Sets optional fields to null." },
    { id: "duplicateId", label: "Duplicate ids", description: "Reuses another row's id." },
  ],
};

/** Only the calls aimed at the messy-config endpoint — other providers (e.g. branding)
 *  issue their own unrelated fetches against the same shared mock. */
function messyCalls(calls: ReturnType<typeof mockFetchRouter>) {
  return calls.filter((c) => c.url.endsWith("/api/dev-mode/messy") && c.init?.method === "POST");
}

/** Mocks the messy-config PATCH endpoint, renders the control on a dev instance with the
 *  given messy state, and opens the dialog — the setup every write-flow test starts from. */
function openMessy(devMessy: typeof messyState = messyState) {
  const calls = mockFetchRouter({ "/api/dev-mode/messy": { ok: true, body: {} } });
  const c = client({ "dev-mode": { devMode: true }, "dev-messy": devMessy });
  renderWithProviders(<MessyDataControl />, { client: c });
  fireEvent.click(screen.getByTestId("messy-open"));
  return calls;
}

afterEach(resetFetchMock);

describe("MessyDataControl", () => {
  it("renders nothing when not a dev instance", () => {
    const c = client({ "dev-mode": { devMode: false }, "dev-messy": messyState });
    renderWithProviders(<MessyDataControl />, { client: c });
    expect(screen.queryByTestId("messy-open")).not.toBeInTheDocument();
  });

  it("shows the config + gremlin catalogue on a dev instance", () => {
    const c = client({ "dev-mode": { devMode: true }, "dev-messy": messyState });
    renderWithProviders(<MessyDataControl />, { client: c });
    fireEvent.click(screen.getByTestId("messy-open"));
    expect(screen.getByTestId("messy-on")).toBeChecked();
    // An empty gremlin list means "all active", so every catalogue entry is checked.
    expect(screen.getByTestId("messy-gremlin-nullify")).toBeChecked();
    expect(screen.getByTestId("messy-gremlin-duplicateId")).toBeChecked();
    expect(screen.getByTestId("messy-gremlins")).toHaveTextContent("Duplicate ids");
  });

  it("shows a bullet on the trigger when injection is on, and an ellipsis when off", () => {
    const on = client({ "dev-mode": { devMode: true }, "dev-messy": messyState });
    const { unmount } = renderWithProviders(<MessyDataControl />, { client: on });
    expect(screen.getByTestId("messy-open")).toHaveTextContent("Messy data ●");
    unmount();

    const off = client({
      "dev-mode": { devMode: true },
      "dev-messy": { ...messyState, config: { ...messyState.config, on: false } },
    });
    renderWithProviders(<MessyDataControl />, { client: off });
    expect(screen.getByTestId("messy-open")).toHaveTextContent("Messy data…");
  });

  it("toggles injection on/off, PATCHing the new value", async () => {
    const calls = openMessy();

    fireEvent.click(screen.getByTestId("messy-on")); // was on:true → toggling off
    await waitFor(() => expect(messyCalls(calls)).toHaveLength(1));
    expect(JSON.parse(String(messyCalls(calls)[0]!.init!.body))).toEqual({ on: false });
  });

  it("changes intensity via the slider, PATCHing the numeric value", async () => {
    const calls = openMessy();

    fireEvent.change(screen.getByTestId("messy-intensity"), { target: { value: "0.7" } });
    await waitFor(() => expect(messyCalls(calls)).toHaveLength(1));
    expect(JSON.parse(String(messyCalls(calls)[0]!.init!.body))).toEqual({ intensity: 0.7 });
  });

  it("commits a new seed on blur, but not when unchanged or blank", async () => {
    const calls = openMessy();
    const seedInput = screen.getByTestId("messy-seed");

    fireEvent.blur(seedInput); // unchanged from cfg.seed ("omni") → no patch
    expect(messyCalls(calls)).toHaveLength(0);

    fireEvent.change(seedInput, { target: { value: "   " } });
    fireEvent.blur(seedInput); // blank after trim → no patch
    expect(messyCalls(calls)).toHaveLength(0);

    fireEvent.change(seedInput, { target: { value: "new-seed" } });
    fireEvent.blur(seedInput);
    await waitFor(() => expect(messyCalls(calls)).toHaveLength(1));
    expect(JSON.parse(String(messyCalls(calls)[0]!.init!.body))).toEqual({ seed: "new-seed" });
  });

  it("adds a gremlin to an explicit list when toggled on", async () => {
    const calls = openMessy({ ...messyState, config: { ...messyState.config, gremlins: ["nullify"] } });

    expect(screen.getByTestId("messy-gremlin-nullify")).toBeChecked();
    expect(screen.getByTestId("messy-gremlin-duplicateId")).not.toBeChecked();

    fireEvent.click(screen.getByTestId("messy-gremlin-duplicateId"));
    await waitFor(() => expect(messyCalls(calls)).toHaveLength(1));
    expect(JSON.parse(String(messyCalls(calls)[0]!.init!.body))).toEqual({ gremlins: ["nullify", "duplicateId"] });
  });

  it("removes a gremlin from an explicit list when toggled off", async () => {
    const calls = openMessy({ ...messyState, config: { ...messyState.config, gremlins: ["nullify", "duplicateId"] } });

    fireEvent.click(screen.getByTestId("messy-gremlin-nullify"));
    await waitFor(() => expect(messyCalls(calls)).toHaveLength(1));
    expect(JSON.parse(String(messyCalls(calls)[0]!.init!.body))).toEqual({ gremlins: ["duplicateId"] });
  });

  it("closes the dialog via Done", async () => {
    openMessy();
    expect(screen.getByText("Messy data (dev)")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByText("Messy data (dev)")).not.toBeInTheDocument());
  });
});
