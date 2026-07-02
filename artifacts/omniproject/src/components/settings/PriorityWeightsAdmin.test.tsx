import { describe, it, expect, vi, afterEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../test/utils";
import { priorityWeightsQueryKey } from "../../lib/priority-weights-api";
import { DEFAULT_PRIORITY_WEIGHTS, type PriorityWeights } from "../../lib/portfolio-priority";
import { PriorityWeightsAdmin } from "./PriorityWeightsAdmin";

function seed(role: string | undefined, weights: PriorityWeights): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity }, mutations: { retry: false } } });
  if (role) qc.setQueryData(["auth", "me"], { sub: "u1", role });
  qc.setQueryData(priorityWeightsQueryKey, weights);
  return qc;
}

afterEach(() => vi.restoreAllMocks());

describe("PriorityWeightsAdmin", () => {
  it("renders nothing for a non-PMO session", () => {
    renderWithProviders(<PriorityWeightsAdmin />, { client: seed("manager", DEFAULT_PRIORITY_WEIGHTS) });
    expect(screen.queryByTestId("priority-weights-admin")).not.toBeInTheDocument();
  });

  it("edits a weight and saves it", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ priorityWeights: DEFAULT_PRIORITY_WEIGHTS }) } as Response);
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<PriorityWeightsAdmin />, { client: seed("pmo", DEFAULT_PRIORITY_WEIGHTS) });

    fireEvent.change(screen.getByLabelText("RICE weight"), { target: { value: "40" } });
    fireEvent.click(screen.getByText("Save weights"));

    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[0] === "/api/portfolio/priority-weights")).toBe(true));
    const [, init] = fetchMock.mock.calls.find((c) => c[0] === "/api/portfolio/priority-weights")!;
    expect((init as RequestInit).method).toBe("PUT");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.priorityWeights).toMatchObject({ rice: 40, wsjf: DEFAULT_PRIORITY_WEIGHTS.wsjf });
  });

  it("restores defaults without a round-trip", () => {
    renderWithProviders(<PriorityWeightsAdmin />, { client: seed("pmo", { rice: 90, wsjf: 0, moscow: 0, strategic: 0, benefit: 0 }) });
    fireEvent.click(screen.getByText("Restore defaults"));
    expect(screen.getByLabelText("RICE weight")).toHaveValue(DEFAULT_PRIORITY_WEIGHTS.rice);
  });

  it("disables Save when nothing changed", () => {
    renderWithProviders(<PriorityWeightsAdmin />, { client: seed("pmo", DEFAULT_PRIORITY_WEIGHTS) });
    expect(screen.getByText("Save weights")).toBeDisabled();
  });
});
