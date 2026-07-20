import { describe, it, expect, afterEach } from "vitest";
import { useOfflineCacheSetting } from "./use-offline-cache";

/** The per-user offline-cache toggle store — persists to localStorage; off wipes (no-op in jsdom). */
afterEach(() => { try { localStorage.clear(); } catch { /* ignore */ } useOfflineCacheSetting.setState({ enabled: false }); });

describe("useOfflineCacheSetting", () => {
  it("persists the opt-in to localStorage and reflects it in state", () => {
    useOfflineCacheSetting.getState().setEnabled(true);
    expect(localStorage.getItem("omni.offlineCache")).toBe("1");
    expect(useOfflineCacheSetting.getState().enabled).toBe(true);
  });

  it("turning it off records the choice (and triggers a wipe)", () => {
    useOfflineCacheSetting.getState().setEnabled(true);
    useOfflineCacheSetting.getState().setEnabled(false); // clearOfflineCache() is a no-op without indexedDB
    expect(localStorage.getItem("omni.offlineCache")).toBe("0");
    expect(useOfflineCacheSetting.getState().enabled).toBe(false);
  });
});
