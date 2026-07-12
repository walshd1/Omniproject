import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders } from "../../test/utils";
import { brokerKindsQueryKey } from "../../lib/broker-kinds";
import { BrokerKindsAdmin } from "./BrokerKindsAdmin";

// Two catalogue brokers for the picker + validity feedback (ids only; sourced at runtime in the app).
const BROKERS = [{ id: "alpha-broker", label: "Alpha" }, { id: "beta-broker", label: "Beta" }];

function seed(role: string | undefined, kinds: string[]): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  if (role) qc.setQueryData(["auth", "me"], { authenticated: true, role, user: { sub: "u1" } });
  qc.setQueryData(brokerKindsQueryKey, kinds);
  qc.setQueryData(["setup", "brokers"], BROKERS);
  return qc;
}

afterEach(() => vi.restoreAllMocks());

describe("BrokerKindsAdmin", () => {
  it("renders nothing for a non-admin", () => {
    renderWithProviders(<BrokerKindsAdmin />, { client: seed("pmo", []) });
    expect(screen.queryByTestId("broker-kinds-admin")).not.toBeInTheDocument();
  });

  it("flags an unknown broker id and disables Save", () => {
    renderWithProviders(<BrokerKindsAdmin />, { client: seed("admin", []) });
    fireEvent.click(screen.getByTestId("broker-kind-add"));
    fireEvent.change(screen.getByLabelText("Broker 1"), { target: { value: "not-a-broker" } });
    expect(screen.getByTestId("broker-kind-save")).toBeDisabled();
  });

  it("PUTs a known broker id to /api/broker-kinds", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    renderWithProviders(<BrokerKindsAdmin />, { client: seed("admin", []) });
    fireEvent.click(screen.getByTestId("broker-kind-add"));
    fireEvent.change(screen.getByLabelText("Broker 1"), { target: { value: "alpha-broker" } });
    fireEvent.click(screen.getByTestId("broker-kind-save"));

    const put = await waitFor(() => {
      const call = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
      expect(call).toBeTruthy();
      return call!;
    });
    expect(String(put[0])).toMatch(/\/broker-kinds$/);
    expect(JSON.parse(String(put[1]?.body)).brokerKinds).toEqual(["alpha-broker"]);
  });
});
