import { useState, type RefObject } from "react";
import { exportSvg, type ExportFormat } from "../../lib/artifact-export";

/**
 * ExportButtons — a small toolbar that exports the SVG inside `targetRef` as a vector (SVG) or raster
 * (PNG/JPEG) file. It finds the first `<svg>` within the referenced container and hands it to the
 * dependency-free export utility, so any chart or graphic primitive becomes downloadable without the
 * primitive itself knowing anything about export. Disables while a raster render is in flight.
 */
export function ExportButtons({ targetRef, title, formats = ["svg", "png", "jpeg"], className = "" }: {
  targetRef: RefObject<HTMLElement | null>;
  title: string;
  formats?: ExportFormat[];
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const onExport = async (format: ExportFormat) => {
    const svg = targetRef.current?.querySelector("svg");
    if (!svg) { setError(true); return; }
    setError(false);
    setBusy(true);
    try {
      await exportSvg(svg as SVGSVGElement, format, title);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`inline-flex items-center gap-1 ${className}`.trim()} role="group" aria-label={`Export ${title}`}>
      {formats.map((f) => (
        <button
          key={f}
          type="button"
          disabled={busy}
          onClick={() => onExport(f)}
          data-testid={`export-${f}`}
          className="px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide rounded-sm border border-border text-muted-foreground hover:bg-muted disabled:opacity-50"
        >
          {f}
        </button>
      ))}
      {error && <span className="text-[10px] text-red-500" role="alert" data-testid="export-error">Nothing to export</span>}
    </div>
  );
}
