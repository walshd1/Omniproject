import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { consentToTool, EGRESS_INFO, type ResolvedTool } from "../lib/tools";

/**
 * Informed-consent gate for a tool whose effective egress leaves the device. It
 * spells out exactly where the data goes (on your device / your own infra / a third
 * party) before the user enables it — the "let people relax it, with information" half
 * of the governance model. On acceptance it records consent and refreshes the tools.
 */
const TONE: Record<"safe" | "caution" | "warn", string> = {
  safe: "text-emerald-600",
  caution: "text-amber-600",
  warn: "text-red-600",
};

export function ToolConsentDialog({
  tool, open, onOpenChange, onConsented,
}: {
  tool: ResolvedTool;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConsented?: () => void;
}) {
  const qc = useQueryClient();
  const egress = tool.effectiveEgress ?? "none";
  const info = EGRESS_INFO[egress];

  const accept = async (): Promise<void> => {
    await consentToTool(tool.id);
    await qc.invalidateQueries({ queryKey: ["tools"] });
    onConsented?.();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="tool-consent-dialog">
        <DialogHeader>
          <DialogTitle>Enable {tool.label}?</DialogTitle>
          <DialogDescription>{tool.description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 text-sm">
          <p>
            Where your data goes:{" "}
            <span className={`font-semibold ${TONE[info.tone]}`} data-testid="tool-egress">{info.label}</span>
          </p>
          <p className="text-muted-foreground">{info.blurb}</p>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" onClick={accept} data-testid="tool-consent-accept">I understand — enable</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
