import { describe, it, expect, vi, afterEach } from "vitest";
import { detectFormFactor, detectOS, detectEngine, resolveMobile, detectPlatform } from "./platform";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

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
    expect(detectOS("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)")).toBe("ios");
    expect(detectOS("Mozilla/5.0 (iPod touch)")).toBe("ios");
  });

  it("uses the navigator.platform hint too, not just the UA", () => {
    expect(detectOS("", "iPhone")).toBe("ios"); // platform arg is concatenated into the match text
  });

  it("treats a plain Mac (no touch) as macos", () => {
    const desc = Object.getOwnPropertyDescriptor(navigator, "maxTouchPoints");
    Object.defineProperty(navigator, "maxTouchPoints", { value: 0, configurable: true });
    try {
      expect(detectOS("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("macos");
    } finally {
      if (desc) Object.defineProperty(navigator, "maxTouchPoints", desc);
      else Object.defineProperty(navigator, "maxTouchPoints", { value: 0, configurable: true });
    }
  });

  it("treats a touch-capable Mac (modern iPad) as ios", () => {
    Object.defineProperty(navigator, "maxTouchPoints", { value: 5, configurable: true });
    try {
      expect(detectOS("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("ios");
    } finally {
      Object.defineProperty(navigator, "maxTouchPoints", { value: 0, configurable: true });
    }
  });
});

describe("detectEngine", () => {
  it("distinguishes the three big engines", () => {
    expect(detectEngine("Mozilla/5.0 (Windows NT 10.0) Gecko/20100101 Firefox/123.0")).toBe("gecko");
    expect(detectEngine("Mozilla/5.0 (X11; Linux) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36")).toBe("chromium");
    expect(detectEngine("Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17 Safari/605.1.15")).toBe("webkit");
  });

  it("classifies Edge, Chrome-on-iOS, and unknown agents", () => {
    expect(detectEngine("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36 Edg/120")).toBe("chromium");
    expect(detectEngine("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) CriOS/120")).toBe("chromium");
    expect(detectEngine("some random string")).toBe("unknown");
  });

  it("does not mistake WebKit's 'like Gecko' for Gecko", () => {
    expect(detectEngine("Mozilla/5.0 (Macintosh) AppleWebKit/605 (KHTML, like Gecko) Safari/605")).toBe("webkit");
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

  it("reports the rich-capability branches when the environment exposes them", () => {
    const savedMTP = Object.getOwnPropertyDescriptor(navigator, "maxTouchPoints");
    const savedMM = Object.getOwnPropertyDescriptor(window, "matchMedia");
    window.matchMedia = ((q: string) => ({ matches: /coarse|standalone/.test(q) })) as unknown as typeof window.matchMedia;
    Object.defineProperty(navigator, "maxTouchPoints", { value: 4, configurable: true });
    Object.defineProperty(navigator, "share", { value: () => {}, configurable: true });
    Object.defineProperty(navigator, "serviceWorker", { value: {}, configurable: true });
    (window as unknown as Record<string, unknown>).SpeechRecognition = function () {};
    (window as unknown as Record<string, unknown>).OmniNative = {};
    try {
      const p = detectPlatform();
      expect(p.touch).toBe(true);
      expect(p.speechRecognition).toBe(true);
      expect(p.webShare).toBe(true);
      expect(p.serviceWorker).toBe(true);
      expect(p.standalone).toBe(true);
      expect(p.nativeBridge).toBe(true);
    } finally {
      delete (window as unknown as Record<string, unknown>).SpeechRecognition;
      delete (window as unknown as Record<string, unknown>).OmniNative;
      delete (navigator as unknown as Record<string, unknown>).share;
      delete (navigator as unknown as Record<string, unknown>).serviceWorker;
      if (savedMTP) Object.defineProperty(navigator, "maxTouchPoints", savedMTP);
      if (savedMM) Object.defineProperty(window, "matchMedia", savedMM);
      else delete (window as unknown as Record<string, unknown>).matchMedia;
    }
  });

  it("treats a fullscreen display-mode as standalone", () => {
    const savedMM = Object.getOwnPropertyDescriptor(window, "matchMedia");
    // Only the fullscreen query matches (standalone does not) → exercises the second media() branch.
    window.matchMedia = ((q: string) => ({ matches: /fullscreen/.test(q) })) as unknown as typeof window.matchMedia;
    try {
      expect(detectPlatform().standalone).toBe(true);
    } finally {
      if (savedMM) Object.defineProperty(window, "matchMedia", savedMM);
      else delete (window as unknown as Record<string, unknown>).matchMedia;
    }
  });

  it("treats an absent navigator.maxTouchPoints as zero (nullish fallback)", () => {
    const savedMTP = Object.getOwnPropertyDescriptor(navigator, "maxTouchPoints");
    const savedMM = Object.getOwnPropertyDescriptor(window, "matchMedia");
    Object.defineProperty(navigator, "maxTouchPoints", { value: undefined, configurable: true });
    delete (window as unknown as Record<string, unknown>).matchMedia; // media() false → coarse relies on maxTouchPoints
    try {
      expect(detectPlatform().touch).toBe(false);
    } finally {
      if (savedMTP) Object.defineProperty(navigator, "maxTouchPoints", savedMTP);
      else Object.defineProperty(navigator, "maxTouchPoints", { value: 0, configurable: true });
      if (savedMM) Object.defineProperty(window, "matchMedia", savedMM);
    }
  });

  it("covers the iOS-standalone path (navigator.standalone) with matchMedia absent", () => {
    const savedMM = Object.getOwnPropertyDescriptor(window, "matchMedia");
    delete (window as unknown as Record<string, unknown>).matchMedia; // media() returns false
    Object.defineProperty(navigator, "standalone", { value: true, configurable: true });
    try {
      expect(detectPlatform().standalone).toBe(true);
    } finally {
      delete (navigator as unknown as Record<string, unknown>).standalone;
      if (savedMM) Object.defineProperty(window, "matchMedia", savedMM);
    }
  });
});
