import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders } from "../../test/utils";
import { GuestInvitePanel } from "./GuestInvitePanel";

// Stub the generated projects hook so the panel has a project to pick.
vi.mock("@workspace/api-client-react", () => ({
  useListProjects: () => ({ data: [{ id: "proj-001", name: "Platform Rewrite" }] }),
}));

function seed(role: string): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(["auth", "me"], { authenticated: true, role, user: { sub: "u1" } });
  return qc;
}

afterEach(() => vi.restoreAllMocks());

describe("GuestInvitePanel", () => {
  it("is hidden from a contributor (server also gates)", () => {
    renderWithProviders(<GuestInvitePanel />, { client: seed("contributor") });
    expect(screen.queryByTestId("guest-invite-admin")).not.toBeInTheDocument();
  });

  it("lets a manager POST a scoped guest invite", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 201 }));
    });
    renderWithProviders(<GuestInvitePanel />, { client: seed("manager") });

    fireEvent.change(screen.getByTestId("guest-invite-email"), { target: { value: "client@x.io" } });
    fireEvent.change(screen.getByTestId("guest-invite-project"), { target: { value: "proj-001" } });
    fireEvent.change(screen.getByTestId("guest-invite-tier"), { target: { value: "comment" } });
    fireEvent.click(screen.getByTestId("guest-invite-send"));

    await waitFor(() => {
      const post = calls.find((c) => c.url.includes("/api/portal/invites"));
      expect(post).toBeTruthy();
      expect(post!.body).toMatchObject({ email: "client@x.io", projectId: "proj-001", tier: "comment" });
    });
  });
});
