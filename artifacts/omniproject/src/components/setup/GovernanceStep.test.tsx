import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../test/utils";
import { GovernanceStep } from "./GovernanceStep";

/** Setup wizard — AI governance walkthrough: admin-only read-only posture summary. */
let fetchMock: ReturnType<typeof vi.fn>;
const ok = (body: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) });

beforeEach(() => {
  fetchMock = vi.fn((url: string) => {
    if (String(url).includes("/api/governance/autonomous")) return ok({ level: "scoped", source: "ai-floor", grants: [{}], aiKill: false });
    if (String(url).includes("/api/governance/actions")) return ok({ actions: [
      { action: "list_projects", approved: true, write: false, scope: {} },
      { action: "update_issue", approved: true, write: true, scope: { surfaces: ["projects"], minRole: "manager" } },
      { action: "delete_issue", approved: false, write: true, scope: {} },
    ] });
    return ok({});
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

describe("GovernanceStep", () => {
  it("renders nothing for a non-admin", () => {
    renderWithProviders(<GovernanceStep isAdmin={false} />, { client: client() });
    expect(screen.queryByText("AI governance")).not.toBeInTheDocument();
  });

  it("summarises the containment, approved actions (scoped count), grants and kill switch", async () => {
    renderWithProviders(<GovernanceStep isAdmin />, { client: client() });
    await waitFor(() => expect(screen.getByTestId("gov-containment")).toHaveTextContent(/scoped/i));
    // 2 approved (1 write), 1 of them scoped per surface/role/backend.
    expect(screen.getByTestId("gov-approved")).toHaveTextContent("2 approved");
    expect(screen.getByTestId("gov-approved")).toHaveTextContent("1 write · 1 scoped");
    expect(screen.getByTestId("gov-grants")).toHaveTextContent("1 active");
    expect(screen.getByTestId("gov-kill")).toHaveTextContent(/Released/);
    expect(screen.getByTestId("gov-settings-link")).toHaveAttribute("href", "/settings");
  });
});
