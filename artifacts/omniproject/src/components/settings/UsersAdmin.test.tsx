import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders } from "../../test/utils";
import { UsersAdmin } from "./UsersAdmin";

/** The in-app users admin panel: hidden for non-admins / when unavailable; lists + creates users. */

vi.mock("../../lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/auth")>();
  return { ...actual, useAuth: () => ({ data: { role: "admin" } }) };
});

const adminClient = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  return qc;
};

afterEach(() => vi.restoreAllMocks());

describe("UsersAdmin", () => {
  it("renders nothing when in-app users are unavailable (no encrypted store / disabled by IdP)", () => {
    const qc = adminClient();
    qc.setQueryData(["users"], { available: false, users: [] });
    const { container } = renderWithProviders(<UsersAdmin />, { client: qc });
    expect(container.querySelector('[data-testid="users-admin"]')).toBeNull();
  });

  it("lists users and creates one via POST /api/users", async () => {
    const qc = adminClient();
    qc.setQueryData(["users"], { available: true, users: [{ id: "local:1", userName: "root", displayName: "Root", email: "", groups: ["omni-admins"], active: true, hasPassword: true, createdAt: "", updatedAt: "" }] });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ user: {} }), { status: 201 }));
    renderWithProviders(<UsersAdmin />, { client: qc });

    expect(screen.getByTestId("user-row-root")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("new-user-username"), { target: { value: "alice" } });
    fireEvent.change(screen.getByTestId("new-user-groups"), { target: { value: "omni-members, viewers" } });
    fireEvent.click(screen.getByTestId("new-user-add"));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith("/api/users", expect.objectContaining({ method: "POST" })));
    const body = JSON.parse((fetchSpy.mock.calls.find((c) => c[0] === "/api/users")![1] as RequestInit).body as string);
    expect(body.userName).toBe("alice");
    expect(body.groups).toEqual(["omni-members", "viewers"]);
  });
});
