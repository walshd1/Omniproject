import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import {
  getListProjectsQueryKey,
  getHealthCheckQueryKey,
  getListNotificationsQueryKey,
  type Project,
} from "@workspace/api-client-react";
import { renderWithProviders } from "../../test/utils";
import { useStore } from "../../store/useStore";
import { AppLayout } from "./AppLayout";

function project(over: Partial<Project> = {}): Project {
  return {
    id: "proj-1",
    name: "Platform Rewrite",
    identifier: "PLT",
    source: "jira",
    issueCount: 0,
    completedCount: 0,
    memberCount: 0,
    updatedAt: new Date(0).toISOString(),
    ...over,
  };
}

function seed(opts: { authed?: boolean; connected?: boolean; brokerConfigured?: boolean } = {}): QueryClient {
  const { authed = true, connected = true, brokerConfigured = true } = opts;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(["auth", "me"], {
    authenticated: authed,
    mode: "demo",
    user: { sub: "u1", name: "Ada Lovelace", email: "ada@example.com" },
    role: "admin",
  });
  qc.setQueryData(getHealthCheckQueryKey(), { status: connected ? "ok" : "down" });
  qc.setQueryData(getListProjectsQueryKey(), [project()]);
  qc.setQueryData(["setup", "status"], {
    configured: brokerConfigured,
    role: "admin",
    broker: { configured: brokerConfigured, urlSet: brokerConfigured },
    auth: { mode: "demo" },
    ai: { provider: "none" },
    capabilities: null,
  });
  qc.setQueryData(getListNotificationsQueryKey(), []);
  return qc;
}

beforeEach(() => {
  // Disable the SSE channel so NotificationsBell doesn't construct an EventSource.
  window.localStorage.setItem("omni.notify.live", "off");
  useStore.setState({ activeProjectId: "proj-1" });
  globalThis.fetch = vi.fn(async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
});

describe("AppLayout", () => {
  it("renders the chrome (nav, brand, children) for an authenticated session", () => {
    renderWithProviders(
      <AppLayout>
        <div>PAGE BODY</div>
      </AppLayout>,
      { client: seed() },
    );
    expect(screen.getByText("PAGE BODY")).toBeInTheDocument();
    // brand mark short name + nav items (localized via i18n defaults)
    expect(screen.getAllByText(/projects/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /skip to content/i })).toBeInTheDocument();
    // role badge + sign-out control
    expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument();
  });

  it("shows the connected gateway-health indicator when health is ok", () => {
    renderWithProviders(
      <AppLayout>
        <div>BODY</div>
      </AppLayout>,
      { client: seed({ connected: true }) },
    );
    expect(screen.getByText(/connected/i)).toBeInTheDocument();
  });

  it("shows the offline indicator when health is not ok", () => {
    renderWithProviders(
      <AppLayout>
        <div>BODY</div>
      </AppLayout>,
      { client: seed({ connected: false }) },
    );
    expect(screen.getByText(/offline/i)).toBeInTheDocument();
  });

  it("renders the demo banner when the broker is not configured", () => {
    renderWithProviders(
      <AppLayout>
        <div>BODY</div>
      </AppLayout>,
      { client: seed({ brokerConfigured: false }) },
    );
    expect(screen.getByText(/demo mode/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open setup/i })).toBeInTheDocument();
  });

  it("shows the authenticating placeholder while auth is loading", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    // No auth data seeded and fetch pending → authLoading path.
    qc.setQueryData(getListNotificationsQueryKey(), []);
    renderWithProviders(
      <AppLayout>
        <div>HIDDEN</div>
      </AppLayout>,
      { client: qc },
    );
    expect(screen.getByText(/authenticating/i)).toBeInTheDocument();
  });
});
