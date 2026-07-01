import { useQuery } from "@tanstack/react-query";

/**
 * DEV MODE watermark — a clear, persistent on-screen marker shown whenever the
 * backend reports it is running as a developer/debug instance (trace, capture,
 * stateful persistence, or the explicit OMNI_DEV_MODE switch). It exists so a
 * debug build can never be mistaken for production at a glance.
 *
 * Reads the public `/api/dev-mode` status (which always reports `devMode:false`
 * in production, where dev mode is hard-gated off), so the watermark simply never
 * appears on a released deployment. The overlay is non-interactive
 * (`pointer-events-none`) and marked decorative for assistive tech; the corner
 * badge carries the same information as text for screen readers.
 */
interface DevModeStatus {
  devMode: boolean;
  env: string;
  surfaces: { persist: boolean; trace: boolean; capture: boolean; messy: boolean };
}

export function DevModeWatermark() {
  const { data } = useQuery<DevModeStatus>({
    queryKey: ["dev-mode"],
    queryFn: async () => (await fetch("/api/dev-mode", { credentials: "same-origin" })).json(),
    staleTime: 60_000,
    retry: false,
  });

  if (!data?.devMode) return null;

  const active = Object.entries(data.surfaces)
    .filter(([, on]) => on)
    .map(([k]) => k);

  return (
    <>
      {/* Diagonal repeating watermark across the whole viewport. */}
      <div
        aria-hidden="true"
        data-testid="dev-mode-watermark"
        className="pointer-events-none fixed inset-0 z-[9999] select-none overflow-hidden"
        style={{
          backgroundImage:
            "repeating-linear-gradient(-45deg, rgba(234,179,8,0.06) 0 12px, transparent 12px 220px)",
        }}
      >
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="rotate-[-30deg] text-[7vw] font-black uppercase tracking-widest text-amber-500/10">
            Dev Mode
          </span>
        </div>
      </div>
      {/* Corner badge — the accessible, textual source of truth. */}
      <div
        role="status"
        data-testid="dev-mode-badge"
        className="pointer-events-none fixed bottom-2 right-2 z-[9999] rounded border border-amber-500/60 bg-amber-500/15 px-2 py-1 text-xs font-semibold text-amber-700 dark:text-amber-300"
      >
        DEV MODE · {data.env}
        {active.length > 0 ? ` · ${active.join(" + ")}` : ""}
      </div>
    </>
  );
}
