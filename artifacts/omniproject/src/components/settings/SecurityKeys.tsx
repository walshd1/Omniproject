import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth, roleAtLeast, logout } from "../../lib/auth";
import { useSecurityKeys, revokeKey, revokeUserSessions, useConfigKeyFingerprint, exportConfigKey, type KeyStatus } from "../../lib/security";
import { stepUp } from "../../lib/step-up";

/**
 * Admin key revocation. Retire a compromised signing key (session / provenance / broker)
 * — it rolls to a fresh derived version and everything signed by the old one is rejected
 * (sessions) or flagged untrusted (provenance). Revoking the SESSION key signs everyone
 * out, including you. Also revoke a single user's sessions. Admin-only.
 */
export function SecurityKeys() {
  const { data: auth } = useAuth();
  const qc = useQueryClient();
  const { data } = useSecurityKeys();
  const { data: configFp } = useConfigKeyFingerprint();
  const [sub, setSub] = useState("");
  const [exported, setExported] = useState<{ key: string; warning: string } | null>(null);

  if (!roleAtLeast(auth?.role, "admin")) return null;
  if (!data?.keys) return null;

  const onExportConfigKey = async (): Promise<void> => {
    if (!window.confirm("Export the config encryption key? It decrypts your config files — handle it like any secret.")) return;
    if (!(await stepUp())) return; // step-up gated
    try { const r = await exportConfigKey(); setExported({ key: r.key, warning: r.warning }); }
    catch { /* surfaced by absence of output */ }
  };

  const onRevoke = async (key: KeyStatus): Promise<void> => {
    const warn = key.name === "session" ? " This signs EVERYONE out, including you." : "";
    const reason = window.prompt(`Revoke + rotate the "${key.name}" key?${warn}\nReason (optional):`);
    if (reason === null) return; // cancelled
    // Key revocation is step-up gated: obtain a fresh re-auth first (demo confirms in
    // place; OIDC navigates to the IdP and the user retries after returning).
    if (!(await stepUp())) return;
    await revokeKey(key.name, reason);
    if (key.name === "session") { void logout(); return; }
    await qc.invalidateQueries({ queryKey: ["security-keys"] });
  };

  return (
    <Card data-testid="security-keys">
      <CardHeader>
        <CardTitle>Security — key revocation</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Retire a signing key if it may be compromised. It rotates to a fresh version;
          anything signed by the revoked version is rejected (sessions) or flagged
          untrusted (provenance).
        </p>
        <ul className="space-y-2">
          {data.keys.map((key) => (
            <li key={key.name} className="flex items-center justify-between gap-4 rounded border border-border p-2 text-sm">
              <div>
                <span className="font-mono font-medium">{key.name}</span>{" "}
                <span className="text-xs text-muted-foreground">v{key.version}{key.revokedVersions.length ? ` · revoked ${key.revokedVersions.join(", ")}` : ""}</span>
                {key.lastReason && <p className="text-xs text-muted-foreground">last: {key.lastReason}</p>}
              </div>
              <Button variant="outline" size="sm" data-testid={`revoke-${key.name}`} onClick={() => void onRevoke(key)}>Revoke &amp; rotate</Button>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-2 border-t border-border pt-3">
          <input
            value={sub}
            onChange={(e) => setSub(e.target.value)}
            placeholder="user id (sub)"
            aria-label="User id to revoke sessions for"
            className="h-9 flex-1 rounded-md border border-border bg-transparent px-2 text-sm"
          />
          <Button
            variant="outline"
            size="sm"
            disabled={!sub.trim()}
            onClick={async () => { await revokeUserSessions(sub.trim()); setSub(""); }}
          >
            Revoke user's sessions
          </Button>
        </div>

        {/* Config-at-rest key: confirm-by-fingerprint + export (to move encrypted files). */}
        <div className="space-y-2 border-t border-border pt-3" data-testid="config-key">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span>
              Config encryption key{" "}
              {configFp && <span className="font-mono text-xs text-muted-foreground">#{configFp.fingerprint}</span>}
            </span>
            <Button variant="outline" size="sm" data-testid="export-config-key" onClick={() => void onExportConfigKey()}>Export key</Button>
          </div>
          <p className="text-xs text-muted-foreground">Config files are encrypted at rest. Export the key to carry encrypted files to another deployment (set it there as <code>CONFIG_KEY_RAW</code>).</p>
          {exported && (
            <div className="rounded border border-amber-300 bg-amber-50 p-2" data-testid="exported-key">
              <p className="mb-1 text-xs text-amber-800">{exported.warning}</p>
              <code className="block break-all rounded bg-background p-1 font-mono text-xs">{exported.key}</code>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
