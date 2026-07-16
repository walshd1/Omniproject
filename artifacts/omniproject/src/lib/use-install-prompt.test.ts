import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useInstallPrompt } from "./use-install-prompt";

/** The PWA install-prompt hook — capture beforeinstallprompt, replay once, reset on appinstalled. */

/** Fabricate a browser-like beforeinstallprompt event with a recorded prompt() + userChoice. */
function makePromptEvent(outcome: "accepted" | "dismissed") {
  const ev = new Event("beforeinstallprompt") as Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
  ev.prompt = () => Promise.resolve();
  ev.userChoice = Promise.resolve({ outcome });
  return ev;
}

describe("useInstallPrompt", () => {
  it("starts uninstallable and offers install once the browser fires the event", () => {
    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current.canInstall).toBe(false);
    act(() => { window.dispatchEvent(makePromptEvent("accepted")); });
    expect(result.current.canInstall).toBe(true);
  });

  it("replays the prompt and returns the outcome, then can't replay again", async () => {
    const { result } = renderHook(() => useInstallPrompt());
    act(() => { window.dispatchEvent(makePromptEvent("accepted")); });
    let outcome: string | undefined;
    await act(async () => { outcome = await result.current.promptInstall(); });
    expect(outcome).toBe("accepted");
    expect(result.current.canInstall).toBe(false);
    // A second replay with nothing pending is a no-op.
    await act(async () => { outcome = await result.current.promptInstall(); });
    expect(outcome).toBe("unavailable");
  });

  it("clears the offer once the app is installed", () => {
    const { result } = renderHook(() => useInstallPrompt());
    act(() => { window.dispatchEvent(makePromptEvent("accepted")); });
    expect(result.current.canInstall).toBe(true);
    act(() => { window.dispatchEvent(new Event("appinstalled")); });
    expect(result.current.canInstall).toBe(false);
  });
});
