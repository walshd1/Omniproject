import { describe, it, expect } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders } from "../../test/utils";
import type { Role } from "../../lib/auth";
import { customRolesKey, type CustomRolesState } from "../../lib/custom-roles";
import { CustomRolesAdmin } from "./CustomRolesAdmin";

/** The custom-roles + permission-sets editor: renders existing config, adds rows, gates on admin. */
function seed(role: Role = "admin", state?: CustomRolesState): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  qc.setQueryData(["auth", "me"], { authenticated: true, role, user: { sub: "u1" } });
  if (state) qc.setQueryData(customRolesKey, state);
  return qc;
}
const STATE: CustomRolesState = {
  config: {
    permissionSets: [{ id: "pack", label: "Insights pack", capabilities: ["portfolio-insights"] }],
    customRoles: [{ id: "finance-analyst", label: "Finance Analyst", baseRole: "contributor", permissionSetIds: ["pack"], groups: ["finance"] }],
  },
  baseRoles: ["viewer", "contributor", "manager", "pmo", "admin"],
  roles: ["guest", "viewer", "contributor", "manager", "pmo", "admin"],
  capabilities: [{ id: "portfolio-insights", label: "Portfolio AI insights", kind: "ai-tool" }, { id: "ai-estimate", label: "AI estimation", kind: "ai-tool" }],
};

describe("CustomRolesAdmin", () => {
  it("renders the existing permission sets and custom roles", () => {
    renderWithProviders(<CustomRolesAdmin />, { client: seed("admin", STATE) });
    expect((screen.getByTestId("ps-id-0") as HTMLInputElement).value).toBe("pack");
    expect((screen.getByTestId("cr-id-0") as HTMLInputElement).value).toBe("finance-analyst");
    expect((screen.getByTestId("cr-base-0") as HTMLSelectElement).value).toBe("contributor");
    expect((screen.getByTestId("cr-groups-0") as HTMLTextAreaElement).value).toBe("finance");
  });

  it("adds a permission set and a custom role", () => {
    renderWithProviders(<CustomRolesAdmin />, { client: seed("admin", STATE) });
    fireEvent.click(screen.getByTestId("add-permission-set"));
    expect(screen.getByTestId("permission-set-1")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("add-custom-role"));
    expect(screen.getByTestId("custom-role-1")).toBeInTheDocument();
  });

  it("removes a custom role", () => {
    renderWithProviders(<CustomRolesAdmin />, { client: seed("admin", STATE) });
    expect(screen.getByTestId("custom-role-0")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("cr-remove-0"));
    expect(screen.queryByTestId("custom-role-0")).not.toBeInTheDocument();
  });

  it("renders nothing for a non-admin", () => {
    const { container } = renderWithProviders(<CustomRolesAdmin />, { client: seed("manager", STATE) });
    expect(container).toBeEmptyDOMElement();
  });
});
