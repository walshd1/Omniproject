import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth, roleAtLeast, logout } from "../../lib/auth";
import { useSecurityKeys, revokeKey, revokeUserSessions, type KeyStatus } from "../../lib/security";

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
  const [sub, setSub] = useState("");

  if (!roleAtLeast(auth?.role, "admin")) return null;
  if (!data?.keys) return null;

  const onRevoke = async (key: KeyStatus): Promise<void> => {
    const warn = key.name === "session" ? " This signs EVERYONE out, including you." : "";
    const reason = window.prompt(`Revoke + rotate the "${key.name}" key?${warn}\nReason (optional):`);
    if (reason === null) return; // cancelled
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
      </CardContent>
    </Card>
  );
}
