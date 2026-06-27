import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getJson } from "../lib/api";
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * Dev-mode impersonation control — the click-to-approve, reason-bearing dialog for
 * an EPHEMERAL auth bypass (act as another user to reproduce a role-specific issue).
 *
 * Only renders on a dev instance (gated by `/api/dev-mode`). Starting an
 * impersonation REQUIRES a typed reason (the dialog won't submit without one); the
 * server records it in the audit log and the bypass expires on its own. While one
 * is active a banner shows who/why with a one-click Stop.
 */
interface DevStatus { devMode: boolean }
interface ImpersonationState { sub: string; email?: string; roles?: string[]; reason: string; by: string; expiresAt: number }

export function DevImpersonationControl() {
  const qc = useQueryClient();
  const { data: dev } = useQuery<DevStatus>({ queryKey: ["dev-mode"], queryFn: () => getJson("/api/dev-mode"), staleTime: 60_000, retry: false });
  const { data: imp } = useQuery<{ impersonation: ImpersonationState | null }>({
    queryKey: ["dev-impersonation"],
    queryFn: () => getJson("/api/dev-mode/impersonate"),
    enabled: !!dev?.devMode,
    retry: false,
  });

  const [open, setOpen] = useState(false);
  const [sub, setSub] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!dev?.devMode) return null;
  const active = imp?.impersonation ?? null;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["dev-impersonation"] });
    // The impersonated identity changes the whole session, so reload to re-fetch as them.
    window.location.reload();
  };

  const start = async () => {
    setError(null);
    const res = await fetch("/api/dev-mode/impersonate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ sub: sub.trim(), email: email.trim() || undefined, roles: role.trim() ? [role.trim()] : undefined, reason: reason.trim() }),
    });
    if (!res.ok) {
      setError((await res.json().catch(() => ({})))?.error ?? "could not start impersonation");
      return;
    }
    setOpen(false);
    refresh();
  };

  const stop = async () => {
    await fetch("/api/dev-mode/impersonate", { method: "DELETE", credentials: "same-origin" });
    refresh();
  };

  if (active) {
    return (
      <div role="status" data-testid="impersonation-banner" className="pointer-events-auto fixed bottom-2 left-2 z-[9999] flex items-center gap-2 rounded border border-amber-500/60 bg-amber-500/15 px-2 py-1 text-xs font-semibold text-amber-700 dark:text-amber-300">
        Impersonating <span className="font-mono">{active.sub}</span> — {active.reason}
        <Button size="sm" variant="outline" className="h-6 px-2 py-0 text-xs" onClick={stop} data-testid="impersonation-stop">Stop</Button>
      </div>
    );
  }

  const canSubmit = sub.trim().length > 0 && reason.trim().length >= 3;

  return (
    <div className="pointer-events-auto fixed bottom-9 left-2 z-[9999]">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button size="sm" variant="outline" className="h-6 px-2 py-0 text-xs" data-testid="impersonate-open">Impersonate…</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Impersonate a user (dev)</DialogTitle>
            <DialogDescription>
              An ephemeral auth bypass for reproducing role-specific issues. It expires automatically and is recorded in the audit log with your reason. A reason is required.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="imp-sub">User id (sub)</Label>
              <Input id="imp-sub" value={sub} onChange={(e) => setSub(e.target.value)} placeholder="e.g. jane.doe" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="imp-email">Email (optional)</Label>
              <Input id="imp-email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@example.com" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="imp-role">Role claim (optional)</Label>
              <Input id="imp-role" value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. viewer" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="imp-reason">Reason (required)</Label>
              <Textarea id="imp-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why are you impersonating this user?" />
            </div>
            {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={start} disabled={!canSubmit} data-testid="impersonate-confirm">Approve &amp; impersonate</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
