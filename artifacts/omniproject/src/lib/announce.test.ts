import { describe, it, expect, beforeEach } from "vitest";
import { announce, announceVerbose, setAnnounceVerbose } from "./announce";

/**
 * The shared ARIA live region: it announces, switches politeness, and gates verbose
 * narration behind the user's screen-reader preference.
 */
describe("announce", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    setAnnounceVerbose(false);
  });

  it("creates one reusable live region and writes the message into it", () => {
    announce("Hello");
    const region = document.querySelector('[data-testid="a11y-announcer"]');
    expect(region).not.toBeNull();
    expect(region).toHaveTextContent("Hello");
    announce("World");
    expect(document.querySelectorAll('[data-testid="a11y-announcer"]').length).toBe(1);
    expect(region).toHaveTextContent("World");
  });

  it("reflects the requested politeness", () => {
    announce("urgent", "assertive");
    const region = document.querySelector('[data-testid="a11y-announcer"]')!;
    expect(region.getAttribute("aria-live")).toBe("assertive");
    announce("calm", "polite");
    expect(region.getAttribute("aria-live")).toBe("polite");
  });

  it("announceVerbose stays silent unless verbose is enabled", () => {
    announceVerbose("quiet");
    expect(document.querySelector('[data-testid="a11y-announcer"]')).toBeNull();
    setAnnounceVerbose(true);
    announceVerbose("loud");
    expect(document.querySelector('[data-testid="a11y-announcer"]')).toHaveTextContent("loud");
  });
});
