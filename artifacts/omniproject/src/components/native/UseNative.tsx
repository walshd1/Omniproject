import { useState } from "react";
import { ExternalLink, Link2, Monitor, X } from "lucide-react";
import { useNativeSurfaces, useNativeHandoff, useNativeImport, type NativeSurface, type NativeSurfaceKind, type NativeContextRef } from "../../lib/native";
import { useToast } from "@/hooks/use-toast";

/**
 * The reusable "Use native" control (companion-app bridge, roadmap X.1). Renders one button per connected
 * vendor that fronts this artifact `kind`; clicking hands off to the vendor (opens the vetted, host-allowlisted
 * URL in the user's own browser), and — once handed off — offers to bring the reference back as an attachment
 * on the anchoring work item. A surface that advertises the `embed` action additionally offers an inline
 * PREVIEW: a sandboxed <iframe> pointed at the vendor's official Live-Embed URL (Tier-2), which is minted
 * server-side against the vendor's allowlisted host and only renders when the deployment allowlists that host
 * in CSP_FRAME_SRC. No per-vendor UI: it's all driven by the advertised surfaces. Renders NOTHING when nothing
 * is connected (the module is off, or no backend fronts this kind), so it's safe to place anywhere.
 */
export function UseNative({ kind, contextRef }: { kind: NativeSurfaceKind; contextRef?: NativeContextRef }) {
  const { data: surfaces } = useNativeSurfaces();
  const handoff = useNativeHandoff();
  const importRef = useNativeImport();
  const { toast } = useToast();
  const [handedOff, setHandedOff] = useState<{ vendor: string; label: string } | null>(null);
  const [embed, setEmbed] = useState<{ url: string; label: string } | null>(null);

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

  // Tier-2: mint the vendor's sandboxed Live-Embed URL and preview it inline.
  const preview = (vendor: string, label: string) => {
    handoff.mutate(
      { kind, vendor, action: "embed", ...(contextRef ? { contextRef } : {}) },
      {
        onSuccess: (h) => setEmbed({ url: h.embedUrl ?? h.url, label }),
        onError: () => toast({ title: "Couldn't load the preview", variant: "destructive" }),
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

  const canEmbed = (s: NativeSurface) => s.actions.includes("embed");

  return (
    <div className="inline-flex flex-col items-end gap-2" data-testid="use-native">
      <div className="inline-flex items-center gap-2">
        {matching.map((s) => (
          <span key={s.vendor} className="inline-flex items-center gap-1">
            <button
              type="button"
              data-testid={`use-native-${s.vendor}`}
              onClick={() => open(s.vendor, s.label)}
              disabled={handoff.isPending}
              className="inline-flex items-center gap-1.5 border border-border px-2.5 py-1 text-xs font-black uppercase tracking-widest hover:bg-muted/40 disabled:opacity-40"
            >
              <ExternalLink className="w-3.5 h-3.5" />{s.label}
            </button>
            {canEmbed(s) && (
              <button
                type="button"
                data-testid={`use-native-embed-${s.vendor}`}
                onClick={() => preview(s.vendor, s.label)}
                disabled={handoff.isPending}
                aria-label={`Preview ${s.label} inline`}
                className="inline-flex items-center border border-border px-1.5 py-1 text-xs hover:bg-muted/40 disabled:opacity-40"
              >
                <Monitor className="w-3.5 h-3.5" />
              </button>
            )}
          </span>
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

      {embed && (
        <div className="w-full border border-border bg-card" data-testid="use-native-embed">
          <div className="flex items-center justify-between border-b border-border px-2 py-1">
            <span className="text-xs font-black uppercase tracking-widest">{embed.label} — live preview</span>
            <button type="button" data-testid="use-native-embed-close" onClick={() => setEmbed(null)} aria-label="Close preview" className="text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>
          {/* Sandboxed: the vendor's Live-Embed runs in its OWN origin, isolated from our page; it loads only
              when the deployment allowlists the vendor host in CSP_FRAME_SRC. */}
          <iframe
            data-testid="use-native-embed-frame"
            title={`${embed.label} live preview`}
            src={embed.url}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            referrerPolicy="no-referrer"
            className="w-full h-[480px] border-0 bg-background"
          />
        </div>
      )}
    </div>
  );
}
