import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { KeyRound, AlertTriangle, Download, Upload } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useAuth, roleAtLeast } from "../../lib/auth";
import { withStepUp } from "../../lib/step-up";
import { useRecoveryKeyStatus, revealRecoveryKey, rotateRecoveryKey, downloadPortableBackup, restorePortableBackup, recoveryKeyStatusKey } from "../../lib/recovery-key";

/**
 * INSTANCE RECOVERY KEY — the portable secret the operator must SAVE (offline / printed) to open an encrypted
 * backup on a fresh box. Reveal it once, download a portable backup sealed under it, and restore with the old
 * key (which then rotates + re-reveals a new one). Admin + step-up gated. Hidden when no encrypted store.
 */
export function RecoveryKeyAdmin() {
  const { data: auth } = useAuth();
  const { data: status } = useRecoveryKeyStatus();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [shownKey, setShownKey] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [restoreKey, setRestoreKey] = useState("");
  const [restoreFile, setRestoreFile] = useState<unknown>(null);

  if (!roleAtLeast(auth?.role, "admin")) return null;
  if (!status?.available) return null;

  const refresh = () => qc.invalidateQueries({ queryKey: recoveryKeyStatusKey });

  const reveal = async (): Promise<void> => {
    setBusy("reveal");
    try { const r = await withStepUp(() => revealRecoveryKey()); if (r) { setShownKey(r.key); await refresh(); } }
    catch (e) { toast({ title: "COULD NOT REVEAL", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" }); }
    finally { setBusy(null); }
  };
  const rotate = async (): Promise<void> => {
    if (!window.confirm("Rotate the recovery key? The current key will no longer be this instance's key (existing backups still open with the key they were sealed under).")) return;
    setBusy("rotate");
    try { const r = await withStepUp(() => rotateRecoveryKey()); if (r) { setShownKey(r.key); await refresh(); } }
    catch (e) { toast({ title: "COULD NOT ROTATE", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" }); }
    finally { setBusy(null); }
  };
  const backup = async (): Promise<void> => {
    setBusy("backup");
    try { const ok = await withStepUp(async () => { await downloadPortableBackup(); return true; }); if (ok) toast({ title: "BACKUP DOWNLOADED", description: "Keep it with your recovery key." }); }
    catch (e) { toast({ title: "BACKUP FAILED", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" }); }
    finally { setBusy(null); }
  };
  const restore = async (): Promise<void> => {
    if (!restoreFile || !restoreKey.trim()) return;
    setBusy("restore");
    try {
      const r = await withStepUp(() => restorePortableBackup(restoreFile, restoreKey.trim()));
      if (r) { setShownKey(r.newKey); setRestoreFile(null); setRestoreKey(""); await refresh(); toast({ title: "RESTORED", description: "Save your NEW recovery key below." }); }
    } catch (e) { toast({ title: "RESTORE FAILED", description: e instanceof Error ? e.message : "Check the key + file.", variant: "destructive" }); }
    finally { setBusy(null); }
  };

  const onFile = (f: File | undefined): void => {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => { try { setRestoreFile(JSON.parse(String(reader.result))); } catch { toast({ title: "BAD FILE", description: "That isn't a valid backup file.", variant: "destructive" }); } };
    reader.readAsText(f);
  };

  return (
    <Card data-testid="recovery-key-admin">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><KeyRound className="w-4 h-4" /> Recovery key &amp; backup</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="flex items-start gap-2 text-xs text-amber-600" data-testid="recovery-key-warning">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          Your <strong>recovery key</strong> is the only thing that can open an encrypted backup if you lose this
          server. Reveal it once and store it somewhere <strong>separate</strong> — a password manager, or printed
          and locked away. It is not shown again. Lose it and your encrypted backups can't be opened.
        </p>

        {shownKey ? (
          <div className="border-2 border-foreground p-3 space-y-2" data-testid="recovery-key-value">
            <p className="text-xs font-bold uppercase tracking-widest">Save this key now — it won't be shown again</p>
            <code className="block break-all bg-muted p-2 text-sm select-all">{shownKey}</code>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => { void navigator.clipboard?.writeText(shownKey); toast({ title: "COPIED" }); }}>Copy</Button>
              <Button type="button" size="sm" variant="outline" onClick={() => window.print()}>Print</Button>
              <Button type="button" size="sm" onClick={() => setShownKey(null)}>I've saved it</Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {!status.revealed && <Button type="button" onClick={() => void reveal()} disabled={busy !== null} data-testid="recovery-key-reveal">{busy === "reveal" ? "…" : "Reveal recovery key"}</Button>}
            <Button type="button" variant="outline" onClick={() => void rotate()} disabled={busy !== null} data-testid="recovery-key-rotate">{busy === "rotate" ? "…" : "Rotate key"}</Button>
            <Button type="button" variant="outline" onClick={() => void backup()} disabled={busy !== null} data-testid="recovery-key-backup"><Download className="w-3.5 h-3.5 mr-1" />Download backup</Button>
          </div>
        )}
        {status.revealed && !shownKey && <p className="text-[11px] text-muted-foreground">The current key was already revealed. If you didn't save it, rotate to mint a new one.</p>}
        {status.fingerprint && <p className="text-[11px] text-muted-foreground font-mono">Key fingerprint: {status.fingerprint}</p>}

        {/* Restore */}
        <div className="border-t border-border pt-3 space-y-2">
          <p className="text-xs font-semibold flex items-center gap-1.5"><Upload className="w-3.5 h-3.5" /> Restore from a portable backup</p>
          <p className="text-[11px] text-muted-foreground">Upload the backup file and paste the recovery key it was saved with. On success the instance rotates to a fresh key — save that one too.</p>
          <input type="file" accept="application/json,.json" data-testid="recovery-restore-file" onChange={(e) => onFile(e.target.files?.[0])} className="text-xs" />
          <input type="password" placeholder="recovery key (base64)" value={restoreKey} onChange={(e) => setRestoreKey(e.target.value)} data-testid="recovery-restore-key" className="block w-full border border-border bg-background px-2 py-1.5 text-xs font-mono" />
          <Button type="button" variant="outline" onClick={() => void restore()} disabled={busy !== null || !restoreFile || !restoreKey.trim()} data-testid="recovery-restore">{busy === "restore" ? "Restoring…" : "Restore"}</Button>
        </div>
      </CardContent>
    </Card>
  );
}
