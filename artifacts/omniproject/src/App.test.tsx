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
});
