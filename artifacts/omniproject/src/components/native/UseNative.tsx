import { useState } from "react";
import { ExternalLink, Link2 } from "lucide-react";
import { useNativeSurfaces, useNativeHandoff, useNativeImport, type NativeSurfaceKind, type NativeContextRef } from "../../lib/native";
import { useToast } from "@/hooks/use-toast";

/**
 * The reusable "Use native" control (companion-app bridge, roadmap X.1). Renders one button per connected
 * vendor that fronts this artifact `kind`; clicking hands off to the vendor (opens the vetted, host-allowlisted
 * URL in the user's own browser), and — once handed off — offers to bring the reference back as an attachment
 * on the anchoring work item. No per-vendor UI: it's all driven by the advertised surfaces. Renders NOTHING
 * when nothing is connected (the module is off, or no backend fronts this kind), so it's safe to place anywhere.
 */
export function UseNative({ kind, contextRef }: { kind: NativeSurfaceKind; contextRef?: NativeContextRef }) {
  const { data: surfaces } = useNativeSurfaces();
  const handoff = useNativeHandoff();
  const importRef = useNativeImport();
  const { toast } = useToast();
  const [handedOff, setHandedOff] = useState<{ vendor: string; label: string } | null>(null);

  const matching = (Array.isArray(surfaces) ? surfaces : []).filter((s) => s.kind === kind);
  if (matching.length === 0) return null;

  const open = (vendor: string, label: string) => {
    handoff.mutate(
      { kind, vendor, action: "open", ...(contextRef ? { contextRef } : {}) },
      {
        onSuccess: (h) => {
          if (typeof window !== "undefined") window.open(h.url, "_blank", "noopener,noreferrer");
          setHandedOff({ vendor, label });
        },
        onError: () => toast({ title: "Couldn't open the native tool", variant: "destructive" }),
      },
    );
  };

  const attach = () => {
    if (!handedOff || !contextRef?.projectId) return;
    importRef.mutate(
      { kind, vendor: handedOff.vendor, target: { projectId: contextRef.projectId, ...(contextRef.issueId ? { issueId: contextRef.issueId } : {}) } },
      {
        onSuccess: () => { toast({ title: "REFERENCE ATTACHED", description: `Linked back from ${handedOff.label}.` }); setHandedOff(null); },
        onError: () => toast({ title: "Couldn't attach the reference", variant: "destructive" }),
      },
    );
  };

  return (
    <div className="inline-flex items-center gap-2" data-testid="use-native">
      {matching.map((s) => (
        <button
          key={s.vendor}
          type="button"
          data-testid={`use-native-${s.vendor}`}
          onClick={() => open(s.vendor, s.label)}
          disabled={handoff.isPending}
          className="inline-flex items-center gap-1.5 border border-border px-2.5 py-1 text-xs font-black uppercase tracking-widest hover:bg-muted/40 disabled:opacity-40"
        >
          <ExternalLink className="w-3.5 h-3.5" />{s.label}
        </button>
      ))}
      {handedOff && contextRef?.projectId && (
        <button
          type="button"
          data-testid="use-native-attach"
          onClick={attach}
          disabled={importRef.isPending}
          className="inline-flex items-center gap-1.5 border border-primary bg-primary text-primary-foreground px-2.5 py-1 text-xs font-black uppercase tracking-widest disabled:opacity-40"
        >
          <Link2 className="w-3.5 h-3.5" />Attach reference
        </button>
      )}
    </div>
  );
}
