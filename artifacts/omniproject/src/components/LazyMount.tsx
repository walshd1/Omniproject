import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Defer mounting `children` until this block scrolls near the viewport, so a long page (e.g. Settings,
 * with ~29 admin panels each firing its own query on mount) doesn't stampede dozens of concurrent
 * requests at once. Renders the same `mt-10` spacing wrapper so layout is unchanged; once shown it
 * stays mounted. Where IntersectionObserver isn't available (SSR / jsdom tests) it mounts immediately,
 * so nothing that renders the page in a test is affected.
 */
export function LazyMount({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (shown) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") { setShown(true); return; }
    const io = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) { setShown(true); io.disconnect(); } },
      { rootMargin: "300px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [shown]);
  return (
    <div ref={ref} className="mt-10" style={shown ? undefined : { minHeight: 120 }}>
      {shown ? children : null}
    </div>
  );
}
