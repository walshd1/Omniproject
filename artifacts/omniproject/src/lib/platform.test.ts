import { describe, it, expect } from "vitest";
import { detectFormFactor, detectOS, detectEngine, resolveMobile, detectPlatform } from "./platform";

/**
 * Platform detection is FEATURE-first; the coarse OS/engine hints are best-effort and
 * used only for copy + install routing. These cover the pure, deterministic helpers.
 */
describe("detectFormFactor", () => {
  it("phones by width", () => {
    expect(detectFormFactor(375, true)).toBe("mobile");
    expect(detectFormFactor(768, true)).toBe("mobile");
  });
  it("uses pointer type to split tablet from small laptop in the mid range", () => {
    expect(detectFormFactor(900, true)).toBe("tablet"); // coarse pointer ⇒ tablet
    expect(detectFormFactor(900, false)).toBe("desktop"); // fine pointer ⇒ desktop
  });
  it("desktops above the tablet ceiling regardless of pointer", () => {
    expect(detectFormFactor(1440, true)).toBe("desktop");
  });
});

describe("detectOS", () => {
  it("recognises the major platforms from the UA", () => {
    expect(detectOS("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe("ios");
    expect(detectOS("Mozilla/5.0 (Linux; Android 14; Pixel 8)")).toBe("android");
    expect(detectOS("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("windows");
    expect(detectOS("Mozilla/5.0 (X11; Linux x86_64)")).toBe("linux");
    expect(detectOS("totally unknown agent")).toBe("unknown");
  });
});

describe("detectEngine", () => {
  it("distinguishes the three big engines", () => {
    expect(detectEngine("Mozilla/5.0 (Windows NT 10.0) Gecko/20100101 Firefox/123.0")).toBe("gecko");
    expect(detectEngine("Mozilla/5.0 (X11; Linux) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36")).toBe("chromium");
    expect(detectEngine("Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17 Safari/605.1.15")).toBe("webkit");
  });
});

describe("resolveMobile", () => {
  it("honours an explicit on/off override", () => {
    expect(resolveMobile("on", "desktop")).toBe(true);
    expect(resolveMobile("off", "mobile")).toBe(false);
  });
  it("follows the device on auto", () => {
    expect(resolveMobile("auto", "mobile")).toBe(true);
    expect(resolveMobile("auto", "tablet")).toBe(true);
    expect(resolveMobile("auto", "desktop")).toBe(false);
  });
});

describe("detectPlatform", () => {
  it("returns a complete, well-typed snapshot in the test DOM", () => {
    const p = detectPlatform();
    expect(typeof p.speechRecognition).toBe("boolean");
    expect(typeof p.touch).toBe("boolean");
    expect(typeof p.serviceWorker).toBe("boolean");
    expect(["mobile", "tablet", "desktop"]).toContain(p.formFactor);
    // jsdom has no SpeechRecognition and no native bridge by default.
    expect(p.speechRecognition).toBe(false);
    expect(p.nativeBridge).toBe(false);
  });
});
