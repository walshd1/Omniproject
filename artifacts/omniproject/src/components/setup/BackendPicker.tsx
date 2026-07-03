import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PlugZap, HelpCircle } from "lucide-react";
import { fetchBackends } from "../../lib/setup";
import { RequestVendorDialog } from "./RequestVendorDialog";

/**
 * "Tell us what you have" — a picker instead of the raw backend id a technical setup
 * would ask for. Picking a tile here is purely a convenience: it carries the choice down
 * to the Generate step (below) so nobody has to pick twice, but nothing is wired up yet —
 * that still needs the connection address underneath.
 */
export function BackendPicker({
  backendId,
  setBackendId,
}: {
  backendId: string;
  setBackendId: (id: string) => void;
}) {
  // Shared cache key with GenerateStep's own query — picking a tile here and reaching
  // the Generate step further down reuses the same network round trip.
  const { data: backends = [] } = useQuery({ queryKey: ["setup-backends"], queryFn: fetchBackends, staleTime: 60_000 });
  const [requestOpen, setRequestOpen] = useState(false);

  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
        What do you use today?
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2" role="listbox" aria-label="Pick your project tool">
        {backends.map((b) => {
          const selected = b.id === backendId;
          const capCount = Object.values(b.capabilities).filter(Boolean).length;
          return (
            <button
              key={b.id}
              type="button"
              role="option"
              aria-selected={selected}
              onClick={() => setBackendId(b.id)}
              className={`text-left border p-3 text-xs ${selected ? "border-primary bg-primary/10" : "border-border hover:border-primary/50"}`}
            >
              <div className="font-black uppercase tracking-wider flex items-center gap-1.5">
                <PlugZap className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                {b.label}
                {b.tier === "enterprise" && <span className="text-amber-500" title="Licensed feature">★</span>}
              </div>
              <div className="text-muted-foreground mt-1">
                {capCount} thing{capCount === 1 ? "" : "s"} it can read/write
              </div>
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setRequestOpen(true)}
          className="text-left border border-dashed border-border p-3 text-xs text-muted-foreground hover:border-primary/50 hover:text-foreground"
        >
          <div className="font-black uppercase tracking-wider flex items-center gap-1.5">
            <HelpCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            Don't see it?
          </div>
          <div className="mt-1">Tell us what you use — no technical detail needed.</div>
        </button>
      </div>
      <RequestVendorDialog open={requestOpen} onOpenChange={setRequestOpen} />
    </div>
  );
}
