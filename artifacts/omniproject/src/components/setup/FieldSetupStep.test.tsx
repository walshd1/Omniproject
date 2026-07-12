import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders } from "../../test/utils";
import { fieldRoutingQueryKey } from "../../lib/routing";
import { customFieldsQueryKey } from "../../lib/custom-fields";
import { availabilityQueryKey } from "../../lib/availability";
import { FieldSetupStep } from "./FieldSetupStep";

function seed(): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  qc.setQueryData(["auth", "me"], { authenticated: true, role: "admin", user: { sub: "u1" } });
  qc.setQueryData(fieldRoutingQueryKey, []);
  qc.setQueryData(customFieldsQueryKey, []);
  // A wired backend advertising two fields → restricted, 1:1:1 targets those two.
  qc.setQueryData(availabilityQueryKey, { source: "capabilities", fields: ["budget", "status"], available: ["budget", "status"], hidden: [], tables: [], relationships: [] });
  qc.setQueryData(["setup", "status"], { broker: { configured: true } });
  return qc;
}

afterEach(() => vi.restoreAllMocks());

describe("FieldSetupStep", () => {
  it("renders nothing for a non-admin", () => {
    renderWithProviders(<FieldSetupStep n={6} isAdmin={false} />, { client: seed() });
    expect(screen.queryByTestId("field-setup-seed")).not.toBeInTheDocument();
  });

  it("shows current state and PUTs a 1:1:1 identity map for advertised fields", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    renderWithProviders(<FieldSetupStep n={6} isAdmin backendId="sql" />, { client: seed() });

    expect(screen.getByTestId("field-setup-state").textContent).toMatch(/2 advertised/);
    fireEvent.change(screen.getByLabelText("Default broker"), { target: { value: "sidecar" } });
    fireEvent.click(screen.getByTestId("field-setup-seed"));

    const put = await waitFor(() => {
      const call = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
      expect(call).toBeTruthy();
      return call!;
    });
    expect(String(put[0])).toMatch(/\/routing$/);
    expect(JSON.parse(String(put[1]?.body)).fieldRouting).toEqual([
      { uiElement: "budget", vendor: "sql", broker: "sidecar", sourceField: "budget" },
      { uiElement: "status", vendor: "sql", broker: "sidecar", sourceField: "status" },
    ]);
  });
});
