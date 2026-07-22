import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
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

function seed(
  opts: { authed?: boolean; connected?: boolean; brokerConfigured?: boolean; role?: string } = {},
): QueryClient {
  const { authed = true, connected = true, brokerConfigured = true, role = "admin" } = opts;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(["auth", "me"], {
    authenticated: authed,
    mode: "demo",
    user: { sub: "u1", name: "Ada Lovelace", email: "ada@example.com" },
    role,
  });
  qc.setQueryData(getHealthCheckQueryKey(), { status: connected ? "ok" : "down" });
  qc.setQueryData(getListProjectsQueryKey(), [project()]);
  // AppLayout reads the outer-surface public status (broker.configured only), not the
  // PMO/admin-gated internal one.
  qc.setQueryData(["setup", "status", "public"], { broker: { configured: brokerConfigured } });
  qc.setQueryData(getListNotificationsQueryKey(), []);
  return qc;
}

beforeEach(() => {
  // Disable the SSE channel so NotificationsBell doesn't construct an EventSource.
  window.localStorage.setItem("omni.notify.live", "off");
  // These tests exercise the chrome, not first-run onboarding — dismiss the first-run gate so an unconfigured
  // fixture doesn't get redirected to /configurator (that gate is unit-tested in lib/first-run.test).
  window.localStorage.setItem("omni.firstRunDismissed", "1");
  useStore.setState({ activeProjectId: "proj-1", isShortcutsOpen: false, isNewIssueOpen: false });
  globalThis.fetch = vi.fn(async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
  // Known starting location for the chord-navigation tests below (setLocation goes through
  // wouter's own history patch, so this only needs setting once per test, not per assertion).
  window.history.pushState({}, "", "/");
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

  it("labels the main content region for screen readers (route focus target announces the page)", () => {
    renderWithProviders(<AppLayout><div>PAGE BODY</div></AppLayout>, { client: seed() });
    // The focus target the router moves to on navigation carries the page name as its
    // accessible name, so a screen reader announces the new view instead of silence.
    const region = screen.getByRole("region", { name: /main content/i });
    expect(region).toHaveAttribute("id", "main-content");
    expect(region).toHaveAttribute("tabindex", "-1");
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
    expect(screen.getByRole("link", { name: /open configurator/i })).toBeInTheDocument();
  });

  it("collapses the Advanced (governance/config) surfaces for a plain PM but keeps the toggle reachable", () => {
    renderWithProviders(
      <AppLayout>
        <div>BODY</div>
      </AppLayout>,
      { client: seed({ role: "contributor", brokerConfigured: true }) },
    );
    // Everyday surfaces stay flat and visible.
    expect(screen.getAllByText(/projects/i).length).toBeGreaterThan(0);
    // The Advanced group header (a real button) is present and collapsed…
    const advanced = screen.getAllByRole("button", { name: /advanced/i });
    expect(advanced.length).toBeGreaterThan(0);
    expect(advanced[0]).toHaveAttribute("aria-expanded", "false");
    // …so the Settings link is not rendered in the collapsed content.
    expect(screen.queryByRole("link", { name: /settings/i })).toBeNull();
  });

  it("shows the Advanced surfaces open by default for admin/PMO", () => {
    renderWithProviders(
      <AppLayout>
        <div>BODY</div>
      </AppLayout>,
      { client: seed({ role: "pmo", brokerConfigured: true }) },
    );
    const advanced = screen.getAllByRole("button", { name: /advanced/i });
    expect(advanced[0]).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("link", { name: /settings/i }).length).toBeGreaterThan(0);
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

  it("redirects to /login and renders nothing once auth resolves to not-authenticated", async () => {
    renderWithProviders(
      <AppLayout>
        <div>HIDDEN</div>
      </AppLayout>,
      { client: seed({ authed: false }) },
    );
    await waitFor(() => expect(window.location.pathname).toBe("/login"));
    expect(screen.queryByText("HIDDEN")).not.toBeInTheDocument();
  });

  it("renders the branded logo image instead of the short-name mark when branding sets a logoUrl", () => {
    const qc = seed();
    qc.setQueryData(["branding"], {
      appName: "Acme PM", shortName: "AP", logoUrl: "https://cdn.acme.example/logo.png", primaryColor: "",
      loginHeading: "", footerText: "", supportUrl: "", fontFamily: "", entitled: true, locked: false,
    });
    const { container } = renderWithProviders(
      <AppLayout>
        <div>BODY</div>
      </AppLayout>,
      { client: qc },
    );
    // The brand mark's <img> is decorative (alt=""), so it has no accessible role — query the DOM directly.
    expect(container.querySelector("img")).toHaveAttribute("src", "https://cdn.acme.example/logo.png");
  });

  it("falls back to the first project when the active project id matches none of them", () => {
    const qc = seed();
    qc.setQueryData(getListProjectsQueryKey(), [project({ id: "proj-1", name: "Platform Rewrite" }), project({ id: "proj-2", name: "Data Migration" })]);
    useStore.setState({ activeProjectId: "does-not-exist" });
    renderWithProviders(
      <AppLayout>
        <div>BODY</div>
      </AppLayout>,
      { client: qc },
    );
    expect(screen.getByText("Platform Rewrite")).toBeInTheDocument();
    expect(screen.queryByText("Data Migration")).not.toBeInTheDocument();
  });

  it("opens the mobile nav drawer via the hamburger button", async () => {
    renderWithProviders(
      <AppLayout>
        <div>BODY</div>
      </AppLayout>,
      { client: seed() },
    );
    fireEvent.click(screen.getByRole("button", { name: /open navigation menu/i }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("'?' opens the keyboard shortcuts dialog", async () => {
    renderWithProviders(
      <AppLayout>
        <div>BODY</div>
      </AppLayout>,
      { client: seed() },
    );
    fireEvent.keyDown(document, { key: "?" });
    expect(await screen.findByRole("heading", { name: /keyboard shortcuts/i })).toBeInTheDocument();
  });

  it("clicking 'Report a problem' opens its dialog", async () => {
    renderWithProviders(
      <AppLayout>
        <div>BODY</div>
      </AppLayout>,
      { client: seed() },
    );
    fireEvent.click(screen.getByRole("button", { name: /report a problem/i }));
    expect(await screen.findByRole("heading", { name: /report a problem/i })).toBeInTheDocument();
  });

  it("the 'g d' chord navigates to the dashboard and updates the document title", async () => {
    window.history.pushState({}, "", "/projects");
    renderWithProviders(
      <AppLayout>
        <div>BODY</div>
      </AppLayout>,
      { client: seed() },
    );
    fireEvent.keyDown(document, { key: "g" });
    fireEvent.keyDown(document, { key: "d" });
    await waitFor(() => expect(window.location.pathname).toBe("/"));
    expect(document.title).toMatch(/dashboard/i);
  });

  it("clicking the '?' button (not just the key) opens the keyboard shortcuts dialog", async () => {
    renderWithProviders(
      <AppLayout>
        <div>BODY</div>
      </AppLayout>,
      { client: seed() },
    );
    fireEvent.click(screen.getByRole("button", { name: /keyboard shortcuts/i }));
    expect(await screen.findByRole("heading", { name: /keyboard shortcuts/i })).toBeInTheDocument();
  });

  it("clicking sign out signs the session out", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    renderWithProviders(
      <AppLayout>
        <div>BODY</div>
      </AppLayout>,
      { client: seed() },
    );
    fireEvent.click(screen.getByRole("button", { name: /sign out/i }));
    await waitFor(() => {
      const calls = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.some((c) => String(c[0]).includes("/api/auth/logout"))).toBe(true);
    });
  });

  it("the 'g p' chord navigates to /projects", async () => {
    renderWithProviders(
      <AppLayout>
        <div>BODY</div>
      </AppLayout>,
      { client: seed() },
    );
    fireEvent.keyDown(document, { key: "g" });
    fireEvent.keyDown(document, { key: "p" });
    await waitFor(() => expect(window.location.pathname).toBe("/projects"));
  });

  it.each([
    ["r", "/reports"],
    ["e", "/explore"],
    ["s", "/settings"],
    ["c", "/configurator"],
  ])("the 'g %s' chord navigates to %s", async (key, path) => {
    renderWithProviders(<AppLayout><div>BODY</div></AppLayout>, { client: seed() });
    fireEvent.keyDown(document, { key: "g" });
    fireEvent.keyDown(document, { key });
    await waitFor(() => expect(window.location.pathname).toBe(path));
  });

  it("ignores the 'g' chord while the user is typing in a field", () => {
    renderWithProviders(
      <AppLayout>
        <input aria-label="typebox" />
      </AppLayout>,
      { client: seed() },
    );
    const input = screen.getByLabelText("typebox");
    input.focus();
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(document, { key: "g" });
    fireEvent.keyDown(document, { key: "p" });
    // The typing guard stands the chord down, so navigation never fires.
    expect(window.location.pathname).toBe("/");
  });

  it("does not open the shortcuts help when '?' is pressed with a modifier held", () => {
    renderWithProviders(<AppLayout><div>BODY</div></AppLayout>, { client: seed() });
    fireEvent.keyDown(document, { key: "?", ctrlKey: true });
    expect(screen.queryByRole("heading", { name: /keyboard shortcuts/i })).toBeNull();
  });

  it("does not open the shortcuts help via '?' while typing in a field", () => {
    renderWithProviders(
      <AppLayout>
        <input aria-label="typebox" />
      </AppLayout>,
      { client: seed() },
    );
    screen.getByLabelText("typebox").focus();
    fireEvent.keyDown(document, { key: "?" });
    expect(screen.queryByRole("heading", { name: /keyboard shortcuts/i })).toBeNull();
  });

  it("falls back to the 'ME' placeholder and an 'Account' avatar tooltip when the user has no name or email", () => {
    const qc = seed();
    qc.setQueryData(["auth", "me"], { authenticated: true, mode: "demo", user: { sub: "u1" }, role: "admin" });
    renderWithProviders(<AppLayout><div>BODY</div></AppLayout>, { client: qc });
    // "ME" → single token → first initial "M"; the avatar tooltip has no email/name → "Account".
    expect(screen.getByTitle("Account")).toHaveTextContent("M");
  });

  it("omits the role badge when the session carries no role", () => {
    const qc = seed();
    qc.setQueryData(["auth", "me"], { authenticated: true, mode: "demo", user: { name: "Ada", email: "ada@example.com", sub: "u1" }, role: "" });
    renderWithProviders(<AppLayout><div>BODY</div></AppLayout>, { client: qc });
    // The avatar tooltip still shows the email, but no uppercase role chip is rendered.
    expect(screen.getByTitle("ada@example.com")).toBeInTheDocument();
    expect(screen.queryByTitle(/access level/i)).toBeNull();
  });

  it("marks the Configurator nav row with a demo dot when the broker is unconfigured", () => {
    // Admin sees the Advanced shelf open, so the Configurator row (with its demo dot) renders.
    renderWithProviders(
      <AppLayout><div>BODY</div></AppLayout>,
      { client: seed({ role: "admin", brokerConfigured: false }) },
    );
    expect(screen.getAllByTitle("Running in demo mode").length).toBeGreaterThan(0);
  });

  it("suppresses the demo banner on the configurator route itself", () => {
    window.history.pushState({}, "", "/configurator");
    renderWithProviders(
      <AppLayout><div>BODY</div></AppLayout>,
      { client: seed({ brokerConfigured: false }) },
    );
    // No project-context header banner: the top-of-page demo banner is hidden on /configurator.
    expect(screen.queryByText(/demo mode/i)).toBeNull();
  });

  it("renders no project-context crumb when there are no projects at all", () => {
    const qc = seed();
    qc.setQueryData(getListProjectsQueryKey(), []);
    renderWithProviders(<AppLayout><div>BODY</div></AppLayout>, { client: qc });
    expect(screen.queryByText("Platform Rewrite")).toBeNull();
  });
});
