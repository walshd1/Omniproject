import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "./useStore";

// The store is a module singleton; reset the slice we touch before each test.
beforeEach(() => {
  window.localStorage.clear();
  useStore.setState({ activeProjectId: null, theme: "dark" });
});

describe("useStore active-project persistence", () => {
  it("persists the active project id to localStorage", () => {
    useStore.getState().setActiveProjectId("proj-123");
    expect(useStore.getState().activeProjectId).toBe("proj-123");
    expect(window.localStorage.getItem("omniproject-active-project")).toBe("proj-123");
  });

  it("clears the persisted id when set to null", () => {
    useStore.getState().setActiveProjectId("proj-123");
    useStore.getState().setActiveProjectId(null);
    expect(useStore.getState().activeProjectId).toBeNull();
    expect(window.localStorage.getItem("omniproject-active-project")).toBeNull();
  });
});

describe("useStore command palette open state", () => {
  it("accepts a boolean and a functional updater", () => {
    useStore.setState({ isCommandOpen: false });
    useStore.getState().setCommandOpen(true);
    expect(useStore.getState().isCommandOpen).toBe(true);
    useStore.getState().setCommandOpen((v) => !v);
    expect(useStore.getState().isCommandOpen).toBe(false);
    useStore.getState().setCommandOpen((v) => !v);
    expect(useStore.getState().isCommandOpen).toBe(true);
  });
});

describe("useStore theme persistence", () => {
  it("toggles the theme and persists the choice", () => {
    expect(useStore.getState().theme).toBe("dark");
    useStore.getState().toggleTheme();
    expect(useStore.getState().theme).toBe("light");
    expect(window.localStorage.getItem("omniproject-theme")).toBe("light");
    useStore.getState().toggleTheme();
    expect(useStore.getState().theme).toBe("dark");
    expect(window.localStorage.getItem("omniproject-theme")).toBe("dark");
  });

  it("reflects the dark class on the document element", () => {
    useStore.getState().toggleTheme(); // → light
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    useStore.getState().toggleTheme(); // → dark
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});
