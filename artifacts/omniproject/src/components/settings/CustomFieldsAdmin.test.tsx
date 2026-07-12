import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders } from "../../test/utils";
import { customFieldsQueryKey, type CustomField } from "../../lib/custom-fields";
import { CustomFieldsAdmin } from "./CustomFieldsAdmin";

function seed(role: string | undefined, fields: CustomField[]): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  if (role) qc.setQueryData(["auth", "me"], { authenticated: true, role, user: { sub: "u1" } });
  qc.setQueryData(customFieldsQueryKey, fields);
  return qc;
}

afterEach(() => vi.restoreAllMocks());

describe("CustomFieldsAdmin", () => {
  it("renders nothing for a non-admin", () => {
    renderWithProviders(<CustomFieldsAdmin />, { client: seed("pmo", []) });
    expect(screen.queryByTestId("custom-fields-admin")).not.toBeInTheDocument();
  });

  it("flags a key that shadows a superset field and disables Save", () => {
    renderWithProviders(<CustomFieldsAdmin />, { client: seed("admin", []) });
    fireEvent.click(screen.getByTestId("custom-field-add"));
    fireEvent.change(screen.getByLabelText("Field 1 key"), { target: { value: "status" } }); // canonical
    fireEvent.change(screen.getByLabelText("Field 1 label"), { target: { value: "Status" } });
    expect(screen.getByTestId("custom-field-save")).toBeDisabled();
  });

  it("PUTs a valid new field to /api/custom-fields", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    renderWithProviders(<CustomFieldsAdmin />, { client: seed("admin", []) });
    fireEvent.click(screen.getByTestId("custom-field-add"));
    fireEvent.change(screen.getByLabelText("Field 1 key"), { target: { value: "riskAppetite" } });
    fireEvent.change(screen.getByLabelText("Field 1 label"), { target: { value: "Risk appetite" } });
    fireEvent.change(screen.getByLabelText("Field 1 type"), { target: { value: "number" } });
    fireEvent.click(screen.getByTestId("custom-field-save"));

    const put = await waitFor(() => {
      const call = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
      expect(call).toBeTruthy();
      return call!;
    });
    expect(String(put[0])).toMatch(/\/custom-fields$/);
    expect(JSON.parse(String(put[1]?.body)).customFields).toEqual([{ key: "riskAppetite", label: "Risk appetite", type: "number" }]);
  });
});
