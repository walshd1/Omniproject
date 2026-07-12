import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getListProjectsQueryKey } from "@workspace/api-client-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useAuth, isPmoOrAdmin } from "../lib/auth";
import { useToast } from "@/hooks/use-toast";
import { sendJson } from "../lib/api";

/**
 * On-close disposition prompt. Closing a project is a GOVERNANCE act: the admin/PMO chooses where its
 * data lives afterwards — left in the current system of record, or migrated to the self-managed
 * archive — and OmniProject records that against the project's correlation GUID. Closing stickily
 * retires the GUID (no silent reactivation). Only rendered for admin/PMO on a project that carries a
 * GUID; nothing here holds project data.
 */
export function CloseProjectDialog({ projectGuid, projectName, source }: { projectGuid: string; projectName: string; source?: string | undefined }) {
  const { data: auth } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [disposition, setDisposition] = useState<"sor" | "archive">("sor");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  if (!isPmoOrAdmin(auth?.role)) return null;

  const confirm = async () => {
    setBusy(true);
    try {
      await sendJson(`/api/projects/${encodeURIComponent(projectGuid)}/close`, { disposition, source, note }, "POST", "Could not close the project");
      await qc.invalidateQueries({ queryKey: getListProjectsQueryKey() });
      toast({ title: "PROJECT CLOSED", description: disposition === "archive" ? "Recorded for the self-managed archive." : "Left in the current system of record." });
      setOpen(false);
    } catch (e) {
      toast({ title: "COULD NOT CLOSE", description: e instanceof Error ? e.message : "Please try again.", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="flex items-center gap-2 border border-border bg-card px-3 py-2 text-xs font-bold uppercase tracking-wider hover:border-destructive hover:text-destructive">
        Close project…
      </DialogTrigger>
      <DialogContent className="rounded-none border-border">
        <DialogHeader>
          <DialogTitle className="uppercase tracking-wider">Close {projectName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Closing retires this project's correlation GUID — it drops out of live views and can't be
            silently reactivated (moving it back live needs a fresh re-link). Choose where its data lives.
          </p>
          <div className="space-y-1">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Data disposition</Label>
            <select
              className="w-full rounded-none border border-border bg-card px-2 py-2 text-sm font-mono"
              value={disposition}
              onChange={(e) => setDisposition(e.target.value as "sor" | "archive")}
            >
              <option value="sor">Leave in the current system of record</option>
              <option value="archive">Migrate to the self-managed archive</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="close-note" className="text-xs uppercase tracking-wider text-muted-foreground">Note (optional)</Label>
            <input
              id="close-note"
              className="w-full rounded-none border border-border bg-card px-2 py-2 text-sm"
              placeholder="e.g. archive location or decommission ticket"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild><Button variant="outline" className="rounded-none">Cancel</Button></DialogClose>
          <Button className="rounded-none" onClick={confirm} disabled={busy}>{busy ? "Closing…" : "Close project"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
