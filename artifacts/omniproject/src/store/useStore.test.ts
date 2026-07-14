import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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

describe("useStore view + panel setters", () => {
  it("setCurrentView updates state and persists the id", () => {
    useStore.getState().setCurrentView("gantt");
    expect(useStore.getState().currentView).toBe("gantt");
    expect(window.localStorage.getItem("omniproject-view")).toBe("gantt");
  });

  it("setSettingsOpen / setNewIssueOpen / setShortcutsOpen flip their flags", () => {
    const s = useStore.getState();
    s.setSettingsOpen(true);
    expect(useStore.getState().isSettingsOpen).toBe(true);
    s.setNewIssueOpen(true);
    expect(useStore.getState().isNewIssueOpen).toBe(true);
    s.setShortcutsOpen(true);
    expect(useStore.getState().isShortcutsOpen).toBe(true);
    useStore.getState().setSettingsOpen(false);
    expect(useStore.getState().isSettingsOpen).toBe(false);
  });

  it("setAiProvider narrows and stores the provider", () => {
    useStore.getState().setAiProvider("anthropic");
    expect(useStore.getState().aiProvider).toBe("anthropic");
  });
});

// The getInitial* helpers only run at module-init time. Re-import the module with
// localStorage pre-seeded (via vi.resetModules) so the persisted-value branches — a
// stored light theme, a stored valid view, a stored active project — are exercised.
describe("useStore initial state hydration", () => {
  afterEach(() => {
    vi.resetModules();
    window.localStorage.clear();
  });

  it("hydrates theme/view/active-project from localStorage on init", async () => {
    window.localStorage.setItem("omniproject-theme", "light");
    window.localStorage.setItem("omniproject-view", "gantt");
    window.localStorage.setItem("omniproject-active-project", "proj-init");
    vi.resetModules();
    const mod = await import("./useStore");
    const st = mod.useStore.getState();
    expect(st.theme).toBe("light");
    expect(st.currentView).toBe("gantt");
    expect(st.activeProjectId).toBe("proj-init");
  });

  it("falls back to defaults when a stored view is not a valid ViewId", async () => {
    window.localStorage.setItem("omniproject-view", "not-a-view");
    vi.resetModules();
    const mod = await import("./useStore");
    expect(mod.useStore.getState().currentView).toBe("kanban");
    expect(mod.useStore.getState().theme).toBe("dark"); // no stored theme ⇒ default dark
  });
});
