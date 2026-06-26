import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
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
});
