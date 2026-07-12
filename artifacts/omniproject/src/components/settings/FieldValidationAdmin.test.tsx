import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders } from "../../test/utils";
import { fieldValidationQueryKey, type FieldValidationRule } from "../../lib/field-validation";
import { customFieldsQueryKey } from "../../lib/custom-fields";
import { FieldValidationAdmin } from "./FieldValidationAdmin";

function seed(role: string | undefined, rules: FieldValidationRule[]): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  if (role) qc.setQueryData(["auth", "me"], { authenticated: true, role, user: { sub: "u1" } });
  qc.setQueryData(fieldValidationQueryKey, rules);
  qc.setQueryData(customFieldsQueryKey, []);
  return qc;
}

afterEach(() => vi.restoreAllMocks());

describe("FieldValidationAdmin", () => {
  it("renders nothing for a non-admin", () => {
    renderWithProviders(<FieldValidationAdmin />, { client: seed("pmo", []) });
    expect(screen.queryByTestId("field-validation-admin")).not.toBeInTheDocument();
  });

  it("disables Save when a pattern is an invalid regex", () => {
    renderWithProviders(<FieldValidationAdmin />, { client: seed("admin", []) });
    fireEvent.click(screen.getByTestId("validation-add"));
    fireEvent.change(screen.getByLabelText("Rule 1 field"), { target: { value: "name" } });
    fireEvent.change(screen.getByLabelText("Rule 1 pattern"), { target: { value: "[" } }); // uncompilable
    expect(screen.getByTestId("validation-save")).toBeDisabled();
  });

  it("disables Save when a date range is inverted (after later than before)", () => {
    renderWithProviders(<FieldValidationAdmin />, { client: seed("admin", []) });
    fireEvent.click(screen.getByTestId("validation-add"));
    fireEvent.change(screen.getByLabelText("Rule 1 field"), { target: { value: "goLive" } });
    fireEvent.change(screen.getByLabelText("Rule 1 after"), { target: { value: "2025-12-31" } });
    fireEvent.change(screen.getByLabelText("Rule 1 before"), { target: { value: "2025-01-01" } });
    expect(screen.getByTestId("validation-save")).toBeDisabled();
  });

  it("PUTs a well-formed rule to /api/field-validation", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    renderWithProviders(<FieldValidationAdmin />, { client: seed("admin", []) });
    fireEvent.click(screen.getByTestId("validation-add"));
    fireEvent.change(screen.getByLabelText("Rule 1 field"), { target: { value: "budget" } });
    fireEvent.change(screen.getByLabelText("Rule 1 min"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Rule 1 options"), { target: { value: "a, b , b" } });
    fireEvent.click(screen.getByTestId("validation-save"));

    const put = await waitFor(() => {
      const call = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
      expect(call).toBeTruthy();
      return call!;
    });
    expect(String(put[0])).toMatch(/\/field-validation$/);
    expect(JSON.parse(String(put[1]?.body)).fieldValidation).toEqual([{ field: "budget", min: 0, options: ["a", "b"] }]);
  });
});
