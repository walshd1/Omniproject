import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import App from "./App";
import { useStore } from "./store/useStore";

/**
 * Router + shell coverage: App brings its own providers (QueryClient, branding,
 * tooltip, wouter), so we render it directly and drive the route via history.
 * Pages are lazy, hence the async findBy.
 */
function go(path: string) {
  window.history.pushState({}, "", path);
}

// The /programmes/:id and /projects/:id routes pass a render-prop function to wouter, so its
// body (unlike a plain JSX child) only executes once that route actually matches — neither test
// above ever visits it. AppLayout/ProgrammeDetail/ProjectDetail are already covered by their own
// dedicated test files and pull in real data-fetching (auth, projects, health-check) this file
// doesn't seed, so they're stubbed here to isolate what's actually new: that App's router
// resolves the :id param and threads it through to the right page.
vi.mock("./components/layout/AppLayout", () => ({
  AppLayout: ({ children }: { children: ReactNode }) => <div data-testid="app-layout-stub">{children}</div>,
}));
vi.mock("./pages/ProgrammeDetail", () => ({
  ProgrammeDetail: ({ programmeId }: { programmeId: string }) => <div data-testid="programme-detail-stub">{programmeId}</div>,
}));
vi.mock("./pages/ProjectDetail", () => ({
  ProjectDetail: ({ projectId }: { projectId: string }) => <div data-testid="project-detail-stub">{projectId}</div>,
}));

// The remaining routes (below) don't need real data-fetching pages to prove the router wires
// each path to the right component — that's App's job here, not the pages'. Each page already
// has its own dedicated test file for its actual content/data-fetching.
vi.mock("./pages/Home", () => ({ Home: () => <div data-testid="home-stub" /> }));
vi.mock("./pages/MyWork", () => ({ MyWork: () => <div data-testid="my-work-stub" /> }));
vi.mock("./pages/Dashboards", () => ({ Dashboards: () => <div data-testid="dashboards-stub" /> }));
vi.mock("./pages/ContentPages", () => ({ ContentPages: () => <div data-testid="content-stub" /> }));
vi.mock("./pages/Programmes", () => ({ Programmes: () => <div data-testid="programmes-stub" /> }));
vi.mock("./pages/Projects", () => ({ Projects: () => <div data-testid="projects-stub" /> }));
vi.mock("./pages/Reports", () => ({ Reports: () => <div data-testid="reports-stub" /> }));
vi.mock("./pages/Resources", () => ({ Resources: () => <div data-testid="resources-stub" /> }));
vi.mock("./pages/Explore", () => ({ Explore: () => <div data-testid="explore-stub" /> }));
vi.mock("./pages/Settings", () => ({ Settings: () => <div data-testid="settings-stub" /> }));
vi.mock("./pages/Configurator", () => ({ Configurator: () => <div data-testid="configurator-stub" /> }));

afterEach(() => {
  document.documentElement.classList.remove("dark");
  useStore.setState({ theme: "light" });
});

describe("App shell + routing", () => {
  beforeEach(() => go("/login"));

  it("mounts the login route (lazy page resolves through Suspense)", async () => {
    render(<App />);
    // The login card's SSO/demo button appears once the chunk + auth settle.
    expect(await screen.findByRole("button", {}, { timeout: 3000 })).toBeInTheDocument();
  });

  it("falls through to NotFound on an unknown path", async () => {
    go("/this-route-does-not-exist");
    render(<App />);
    expect(await screen.findByRole("heading", { name: /page not found/i }, { timeout: 3000 })).toBeInTheDocument();
  });

  it("ThemeInitializer applies the dark class from the store, and clears it for light", async () => {
    useStore.setState({ theme: "dark" });
    const { rerender } = render(<App />);
    await screen.findByRole("button", {}, { timeout: 3000 });
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    useStore.setState({ theme: "light" });
    rerender(<App />);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("resolves :programmeId from the URL and threads it through to ProgrammeDetail", async () => {
    go("/programmes/prog-42");
    render(<App />);
    // AppLayout/ProgrammeDetail are mocked, so there's no real chunk fetch to wait on —
    // the default findBy timeout is plenty (unlike the real-lazy-load tests above).
    expect(await screen.findByTestId("app-layout-stub")).toBeInTheDocument();
    expect(screen.getByTestId("programme-detail-stub")).toHaveTextContent("prog-42");
  });

  it("resolves :projectId from the URL and threads it through to ProjectDetail", async () => {
    go("/projects/proj-7");
    render(<App />);
    expect(await screen.findByTestId("app-layout-stub")).toBeInTheDocument();
    expect(screen.getByTestId("project-detail-stub")).toHaveTextContent("proj-7");
  });

  it.each([
    ["/", "home-stub"],
    ["/my-work", "my-work-stub"],
    ["/dashboards", "dashboards-stub"],
    ["/content", "content-stub"],
    ["/programmes", "programmes-stub"],
    ["/projects", "projects-stub"],
    ["/reports", "reports-stub"],
    ["/resources", "resources-stub"],
    ["/settings", "settings-stub"],
    ["/configurator", "configurator-stub"],
  ])("routes %s to its page, wrapped in AppLayout", async (path, testId) => {
    go(path);
    render(<App />);
    expect(await screen.findByTestId("app-layout-stub")).toBeInTheDocument();
    expect(screen.getByTestId(testId)).toBeInTheDocument();
  });

  it("routes /explore to Explore, outside the AppLayout chrome", async () => {
    go("/explore");
    render(<App />);
    expect(await screen.findByTestId("explore-stub")).toBeInTheDocument();
    expect(screen.queryByTestId("app-layout-stub")).not.toBeInTheDocument();
  });

  it("redirects /setup to /configurator", async () => {
    go("/setup");
    render(<App />);
    expect(await screen.findByTestId("configurator-stub")).toBeInTheDocument();
  });
});
