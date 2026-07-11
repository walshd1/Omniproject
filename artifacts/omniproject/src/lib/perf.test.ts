import { describe, it, expect, afterEach, vi } from "vitest";
import { parseServerTiming, toApiSample, quantile, summarise, pushCapped, readNavigationTiming } from "./perf";

/**
 * Pure perf helpers: parse the gateway's Server-Timing split, turn resource entries
 * into API samples, and summarise latency distributions for the dev overlay.
 */
describe("parseServerTiming", () => {
  it("pulls upstream/gateway/total durations by name", () => {
    const st = [
      { name: "upstream", duration: 40 },
      { name: "gateway", duration: 8 },
      { name: "total", duration: 48 },
    ];
    expect(parseServerTiming(st)).toEqual({ upstreamMs: 40, gatewayMs: 8, totalMs: 48 });
  });
  it("defaults missing entries to zero", () => {
    expect(parseServerTiming(undefined)).toEqual({ upstreamMs: 0, gatewayMs: 0, totalMs: 0 });
    expect(parseServerTiming([{ name: "total", duration: 12 }])).toEqual({ upstreamMs: 0, gatewayMs: 0, totalMs: 12 });
  });
});

describe("toApiSample", () => {
  it("maps an /api resource entry, splitting gateway vs upstream", () => {
    const entry = {
      name: "https://app.local/api/projects?x=1",
      duration: 53.4,
      serverTiming: [{ name: "upstream", duration: 40 }, { name: "gateway", duration: 8 }],
    } as unknown as PerformanceResourceTiming;
    expect(toApiSample(entry)).toEqual({ url: "/api/projects", durationMs: 53, upstreamMs: 40, gatewayMs: 8 });
  });
  it("ignores non-API resources", () => {
    const entry = { name: "https://app.local/assets/app.js", duration: 5, serverTiming: [] } as unknown as PerformanceResourceTiming;
    expect(toApiSample(entry)).toBeNull();
  });
});

describe("quantile / summarise", () => {
  it("computes percentiles, max and mean", () => {
    const s = summarise([10, 20, 30, 40, 100]);
    expect(s.count).toBe(5);
    expect(s.max).toBe(100);
    expect(s.avg).toBe(40);
    expect(s.p50).toBe(30);
  });
  it("is empty-safe", () => {
    expect(summarise([])).toEqual({ count: 0, p50: 0, p95: 0, max: 0, avg: 0 });
    expect(quantile([], 0.5)).toBe(0);
  });
});

describe("pushCapped", () => {
  it("keeps only the most recent N samples", () => {
    let buf: number[] = [];
    for (let i = 1; i <= 5; i++) buf = pushCapped(buf, i, 3);
    expect(buf).toEqual([3, 4, 5]);
  });
});

describe("readNavigationTiming", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns null when the Performance API is unavailable", () => {
    vi.stubGlobal("performance", undefined);
    expect(readNavigationTiming()).toBeNull();
  });

  it("returns null when getEntriesByType is not a function", () => {
    vi.stubGlobal("performance", {});
    expect(readNavigationTiming()).toBeNull();
  });

  it("returns null when there is no navigation entry", () => {
    vi.stubGlobal("performance", { getEntriesByType: () => [] });
    expect(readNavigationTiming()).toBeNull();
  });

  it("reads and rounds the document navigation timing", () => {
    vi.stubGlobal("performance", {
      getEntriesByType: (t: string) =>
        t === "navigation"
          ? [{ responseStart: 12.4, domContentLoadedEventEnd: 88.6, loadEventEnd: 150.2, duration: 999 }]
          : [],
    });
    expect(readNavigationTiming()).toEqual({ ttfbMs: 12, domContentLoadedMs: 89, loadMs: 150 });
  });

  it("falls back to duration when loadEventEnd is zero", () => {
    vi.stubGlobal("performance", {
      getEntriesByType: (t: string) =>
        t === "navigation" ? [{ responseStart: 1, domContentLoadedEventEnd: 2, loadEventEnd: 0, duration: 42.7 }] : [],
    });
    expect(readNavigationTiming()).toEqual({ ttfbMs: 1, domContentLoadedMs: 2, loadMs: 43 });
  });
});
