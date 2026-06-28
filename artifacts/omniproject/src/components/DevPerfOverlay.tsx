import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  readNavigationTiming, toApiSample, summarise, pushCapped,
  type NavTiming, type ApiSample,
} from "../lib/perf";

/**
 * Dev-mode performance overlay — a small HUD that surfaces the timings we tune
 * against the "2 clicks, under 1 second" adoption bar: initial load (TTFB →
 * DOMContentLoaded → load), live per-API latency split into gateway vs upstream
 * (from the Server-Timing header), and route-switch responsiveness. Shown ONLY when
 * the backend reports a dev/debug instance (same gate as the DEV MODE watermark), so
 * it never appears in production.
 */
interface DevModeStatus { devMode: boolean }

const ms = (n: number): string => `${Math.round(n)}ms`;
// Green under the 1s bar, amber approaching it, red past it.
const band = (n: number): string =>
  n <= 600 ? "text-emerald-400" : n <= 1000 ? "text-amber-400" : "text-red-400";

export function DevPerfOverlay() {
  const { data } = useQuery<DevModeStatus>({
    queryKey: ["dev-mode"],
    queryFn: async () => (await fetch("/api/dev-mode", { credentials: "same-origin" })).json(),
    staleTime: 60_000,
    retry: false,
  });
  const devMode = !!data?.devMode;

  const [open, setOpen] = useState(true);
  const [nav, setNav] = useState<NavTiming | null>(null);
  const [samples, setSamples] = useState<ApiSample[]>([]);
  const [routeMs, setRouteMs] = useState<number | null>(null);
  const [location] = useLocation();
  const firstRender = useRef(true);

  // One-shot navigation timing (deferred so loadEventEnd is populated).
  useEffect(() => {
    if (!devMode) return;
    const t = setTimeout(() => setNav(readNavigationTiming()), 0);
    return () => clearTimeout(t);
  }, [devMode]);

  // Live API latencies via the Performance API (reads Server-Timing natively).
  useEffect(() => {
    if (!devMode || typeof PerformanceObserver === "undefined") return;
    const obs = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const sample = toApiSample(entry as PerformanceResourceTiming);
        if (sample) setSamples((prev) => pushCapped(prev, sample));
      }
    });
    try { obs.observe({ type: "resource", buffered: true }); } catch { /* unsupported */ }
    return () => obs.disconnect();
  }, [devMode]);

  // Route-switch responsiveness: time from a route commit to the next painted frame
  // (skip the very first render — that's the initial load, covered by nav timing).
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    const start = performance.now();
    const raf = requestAnimationFrame(() => setRouteMs(Math.round(performance.now() - start)));
    return () => cancelAnimationFrame(raf);
  }, [location]);

  if (!devMode) return null;

  const totals = summarise(samples.map((s) => s.durationMs));
  const upstream = summarise(samples.map((s) => s.upstreamMs));
  const gateway = summarise(samples.map((s) => s.gatewayMs));

  return (
    <div
      data-testid="dev-perf-overlay"
      className="fixed bottom-2 left-2 z-[9999] w-60 rounded border border-amber-500/50 bg-black/80 p-2 font-mono text-[11px] leading-relaxed text-amber-100 shadow-lg backdrop-blur"
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between font-semibold text-amber-300"
        aria-expanded={open}
      >
        <span>⏱ PERF</span>
        <span>{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <dl className="mt-1 space-y-0.5">
          {nav && (
            <>
              <Row label="TTFB" value={<span className={band(nav.ttfbMs)}>{ms(nav.ttfbMs)}</span>} />
              <Row label="DOMContentLoaded" value={<span className={band(nav.domContentLoadedMs)}>{ms(nav.domContentLoadedMs)}</span>} />
              <Row label="Load" value={<span className={band(nav.loadMs)}>{ms(nav.loadMs)}</span>} />
            </>
          )}
          {routeMs !== null && <Row label="Route switch" value={<span className={band(routeMs)}>{ms(routeMs)}</span>} />}
          <div className="my-1 border-t border-amber-500/20" />
          <Row label={`API calls`} value={String(totals.count)} />
          {totals.count > 0 && (
            <>
              <Row label="API p50 / p95" value={`${ms(totals.p50)} / ${ms(totals.p95)}`} />
              <Row label="API max" value={<span className={band(totals.max)}>{ms(totals.max)}</span>} />
              <Row label="avg gateway / upstream" value={`${ms(gateway.avg)} / ${ms(upstream.avg)}`} />
            </>
          )}
        </dl>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-amber-400/70">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
