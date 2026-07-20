import { describe, it, expect } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders } from "../../test/utils";
import type { Role } from "../../lib/auth";
import { roleMapKey, parseGroups, type RoleMapState } from "../../lib/role-map";
import { RoleMapAdmin } from "./RoleMapAdmin";

/** The admin group→role mapping editor: renders the claim-mappable roles, hides guest, gates on admin. */
function seed(role: Role = "admin"): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  qc.setQueryData(["auth", "me"], { authenticated: true, role, user: { sub: "u1" } });
  const state: RoleMapState = {
    roles: ["guest", "viewer", "contributor", "manager", "pmo", "admin"],
    mapping: [
      { role: "guest", claims: [], source: "env" },
      { role: "viewer", claims: ["staff"], source: "env" },
      { role: "manager", claims: ["omni-managers"], source: "override" },
      { role: "admin", claims: ["omni-admins"], source: "env" },
    ],
    rollbackAvailable: true,
  };
  qc.setQueryData(roleMapKey, state);
  return qc;
}

describe("RoleMapAdmin", () => {
  it("renders the claim-mappable roles with their groups + source, and hides guest", () => {
    renderWithProviders(<RoleMapAdmin />, { client: seed() });
    expect(screen.getByTestId("role-map-row-manager")).toHaveTextContent("override");
    expect((screen.getByTestId("role-map-input-manager") as HTMLTextAreaElement).value).toBe("omni-managers");
    expect(screen.getByTestId("role-map-row-admin")).toBeInTheDocument();
    expect(screen.queryByTestId("role-map-row-guest")).not.toBeInTheDocument();
  });

  it("offers an undo when a rollback is available and edits are local until saved", () => {
    renderWithProviders(<RoleMapAdmin />, { client: seed() });
    expect(screen.getByTestId("role-map-rollback")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("role-map-input-viewer"), { target: { value: "staff, contractors" } });
    expect((screen.getByTestId("role-map-input-viewer") as HTMLTextAreaElement).value).toBe("staff, contractors");
  });

  it("renders nothing for a non-admin", () => {
    const { container } = renderWithProviders(<RoleMapAdmin />, { client: seed("manager") });
    expect(container).toBeEmptyDOMElement();
  });

  it("parseGroups splits, trims, lower-cases and de-dupes", () => {
    expect(parseGroups("A, b\n  A  c")).toEqual(["a", "b", "c"]);
  });
});
