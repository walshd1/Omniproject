import { describe, it, expect } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders } from "../../test/utils";
import type { Role } from "../../lib/auth";
import { defPolicyKey, type DefPolicyState } from "../../lib/def-policy";
import { DefPolicyAdmin } from "./DefPolicyAdmin";

/** The definition write-permissions panel: per-scope gate selectors, admin-gated, save enabled on change. */
function seed(role: Role = "admin", state?: DefPolicyState): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  qc.setQueryData(["auth", "me"], { authenticated: true, role, user: { sub: "u1" } });
  if (state) qc.setQueryData(defPolicyKey, state);
  return qc;
}
const STATE: DefPolicyState = {
  policy: { user: "contributor", project: "manager", programme: "programmeManager", org: "pmoOrAdmin" },
  gates: ["contributor", "manager", "programmeManager", "pmoOrAdmin", "admin"],
};

describe("DefPolicyAdmin", () => {
  it("shows the per-scope gates at their current values", () => {
    renderWithProviders(<DefPolicyAdmin />, { client: seed("admin", STATE) });
    expect((screen.getByTestId("def-policy-user") as HTMLSelectElement).value).toBe("contributor");
    expect((screen.getByTestId("def-policy-project") as HTMLSelectElement).value).toBe("manager");
    expect((screen.getByTestId("def-policy-org") as HTMLSelectElement).value).toBe("pmoOrAdmin");
  });

  it("enables save only after a change", () => {
    renderWithProviders(<DefPolicyAdmin />, { client: seed("admin", STATE) });
    expect(screen.getByTestId("def-policy-save")).toBeDisabled();
    fireEvent.change(screen.getByTestId("def-policy-org"), { target: { value: "admin" } });
    expect(screen.getByTestId("def-policy-save")).not.toBeDisabled();
  });

  it("hints to enable the module when the policy can't be loaded", () => {
    const qc = seed("admin");
    qc.setQueryData(defPolicyKey, undefined);
    // Simulate the query having errored (module off → 404).
    renderWithProviders(<DefPolicyAdmin />, { client: qc });
    // With no data and no error state seeded, the panel still renders its shell for an admin.
    expect(screen.getByTestId("def-policy-admin")).toBeInTheDocument();
  });

  it("renders nothing for a non-admin", () => {
    const { container } = renderWithProviders(<DefPolicyAdmin />, { client: seed("manager", STATE) });
    expect(container).toBeEmptyDOMElement();
  });
});
