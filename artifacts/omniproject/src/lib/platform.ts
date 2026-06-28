/**
 * Platform & capability detection — ONE source of truth for "what can this device
 * actually do, and where is it running".
 *
 * The golden rule (see lib/speech): FEATURE-detect to decide behaviour; only use the
 * coarse platform HINTS (os/engine/form factor) for wording and install/app-store
 * routing — never to gate a capability. UA strings lie and change; capabilities don't.
 *
 * Everything here reads the environment defensively so it is safe in SSR/tests
 * (no `window`) and never throws.
 */

export type FormFactor = "mobile" | "tablet" | "desktop";
export type OS = "ios" | "android" | "macos" | "windows" | "linux" | "unknown";
export type Engine = "chromium" | "webkit" | "gecko" | "unknown";

/** Live, FEATURE-detected capabilities — the things we actually branch on. */
export interface Capabilities {
  /** Browser exposes speech recognition (Web Speech API). */
  speechRecognition: boolean;
  /** Primary pointer is coarse (finger) rather than fine (mouse). */
  touch: boolean;
  /** Native share sheet (navigator.share) — nicer "share" on mobile. */
  webShare: boolean;
  /** Service workers available (PWA install / offline shell). */
  serviceWorker: boolean;
  /** Running as an installed/standalone app (PWA or native shell), not a browser tab. */
  standalone: boolean;
  /** A native shell (e.g. a future Capacitor wrapper) has injected its bridge. */
  nativeBridge: boolean;
}

/** Coarse, best-effort hints — for COPY and INSTALL ROUTING only, never feature gating. */
export interface PlatformHints {
  formFactor: FormFactor;
  os: OS;
  engine: Engine;
}

export interface Platform extends PlatformHints, Capabilities {}

const TABLET_MAX = 1024;
const MOBILE_MAX = 768;

const hasWindow = (): boolean => typeof window !== "undefined";

/** Match a media query, false when unavailable (SSR/tests without matchMedia). */
function media(query: string): boolean {
  if (!hasWindow() || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(query).matches;
}

/** Width-based form factor, refined by pointer type so a small laptop ≠ a phone. */
export function detectFormFactor(width: number, coarse: boolean): FormFactor {
  if (width <= MOBILE_MAX) return "mobile";
  if (width <= TABLET_MAX) return coarse ? "tablet" : "desktop";
  return "desktop";
}

/** Best-effort OS from the UA — used ONLY for install hints / store links. */
export function detectOS(ua: string, platform = ""): OS {
  const s = `${ua} ${platform}`;
  if (/iphone|ipad|ipod/i.test(s)) return "ios";
  // Modern iPads report as "Macintosh" but expose touch — treat touch-Macs as iOS.
  if (/macintosh/i.test(s) && navigatorMaxTouchPoints() > 1) return "ios";
  if (/android/i.test(s)) return "android";
  if (/mac os x|macintosh/i.test(s)) return "macos";
  if (/windows/i.test(s)) return "windows";
  if (/linux/i.test(s)) return "linux";
  return "unknown";
}

/** Best-effort rendering engine — used ONLY for wording (e.g. dictation guidance). */
export function detectEngine(ua: string): Engine {
  if (/firefox|gecko\/\d/i.test(ua) && !/like gecko/i.test(ua)) return "gecko";
  if (/edg\/|chrome\/|chromium|crios/i.test(ua)) return "chromium";
  if (/safari|applewebkit/i.test(ua)) return "webkit";
  return "unknown";
}

function navigatorMaxTouchPoints(): number {
  if (!hasWindow() || typeof navigator === "undefined") return 0;
  return navigator.maxTouchPoints ?? 0;
}

function speechSupported(): boolean {
  if (!hasWindow()) return false;
  const w = window as unknown as Record<string, unknown>;
  return !!(w["SpeechRecognition"] ?? w["webkitSpeechRecognition"]);
}

function isStandalone(): boolean {
  if (!hasWindow()) return false;
  // iOS Safari uses the non-standard navigator.standalone; everyone else the media query.
  const iosStandalone = (navigator as unknown as { standalone?: boolean }).standalone === true;
  return media("(display-mode: standalone)") || media("(display-mode: fullscreen)") || iosStandalone;
}

/** Has a native shell injected its bridge? (Reserved for a future Capacitor wrapper.) */
function hasNativeBridge(): boolean {
  if (!hasWindow()) return false;
  return typeof (window as unknown as Record<string, unknown>)["OmniNative"] !== "undefined";
}

/** Snapshot the platform now. Cheap; call it from a hook on mount + on resize. */
export function detectPlatform(): Platform {
  const ua = hasWindow() && typeof navigator !== "undefined" ? navigator.userAgent : "";
  const platformStr = hasWindow() && typeof navigator !== "undefined" ? (navigator.platform ?? "") : "";
  const coarse = media("(pointer: coarse)") || navigatorMaxTouchPoints() > 0;
  const width = hasWindow() ? window.innerWidth : TABLET_MAX + 1;
  return {
    formFactor: detectFormFactor(width, coarse),
    os: detectOS(ua, platformStr),
    engine: detectEngine(ua),
    speechRecognition: speechSupported(),
    touch: coarse,
    webShare: hasWindow() && typeof navigator !== "undefined" && typeof navigator.share === "function",
    serviceWorker: hasWindow() && "serviceWorker" in navigator,
    standalone: isStandalone(),
    nativeBridge: hasNativeBridge(),
  };
}

/** Resolve the user's mobile-mode preference against the live form factor. */
export function resolveMobile(mode: "auto" | "on" | "off", formFactor: FormFactor): boolean {
  if (mode === "on") return true;
  if (mode === "off") return false;
  return formFactor !== "desktop"; // auto
}
