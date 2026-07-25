import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useAuth, roleAtLeast } from "../../lib/auth";
import { useUsers, createUser, updateUser, setUserPassword, deleteUser, usersKey } from "../../lib/users";

/**
 * NATIVE USER MANAGEMENT (admin). Create/manage in-app users so a deployment can run without an external IdP.
 * A user's GROUPS map to roles through the same group→role mapping an IdP uses (see the Group → role panel), so
 * assigning "omni-admins" here confers admin exactly as an IdP claim would. Passwords are set here but stored in
 * a separately-keyed encrypted store; only presence (Has password) is ever shown. Hidden when the deployment
 * has no encrypted store (nowhere to keep the roster/credentials).
 */
export function UsersAdmin() {
  const { data: auth } = useAuth();
  const { data } = useUsers();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [userName, setUserName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [groups, setGroups] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  if (!roleAtLeast(auth?.role, "admin")) return null;
  if (!data?.available) return null; // no encrypted store → feature unavailable

  const refresh = () => qc.invalidateQueries({ queryKey: usersKey });
  const parseGroups = (s: string): string[] => s.split(",").map((g) => g.trim()).filter(Boolean);

  const add = async (): Promise<void> => {
    if (!userName.trim()) return;
    setBusy(true);
    try {
      await createUser({ userName: userName.trim(), displayName: displayName.trim() || undefined, email: email.trim() || undefined, groups: parseGroups(groups), password: password || undefined });
      setUserName(""); setDisplayName(""); setEmail(""); setGroups(""); setPassword("");
      await refresh();
      toast({ title: "USER ADDED", description: "The in-app user was created." });
    } catch (e) {
      toast({ title: "COULD NOT ADD USER", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" });
    } finally { setBusy(false); }
  };

  const toggleActive = async (id: string, active: boolean): Promise<void> => {
    try { await updateUser(id, { active }); await refresh(); }
    catch (e) { toast({ title: "UPDATE FAILED", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" }); }
  };

  const resetPassword = async (id: string): Promise<void> => {
    const pw = window.prompt("New password (min 8 characters):");
    if (!pw) return;
    try { await setUserPassword(id, pw); toast({ title: "PASSWORD SET", description: "The user can sign in with the new password." }); await refresh(); }
    catch (e) { toast({ title: "COULD NOT SET PASSWORD", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" }); }
  };

  const remove = async (id: string, name: string): Promise<void> => {
    if (!window.confirm(`Delete user "${name}"? This also removes their password.`)) return;
    try { await deleteUser(id); await refresh(); toast({ title: "USER DELETED", description: `${name} was removed.` }); }
    catch (e) { toast({ title: "DELETE FAILED", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" }); }
  };

  const input = "border border-border bg-background px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-ring";

  return (
    <Card data-testid="users-admin">
      <CardHeader>
        <CardTitle>In-app users</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Native accounts, so you don't need an external identity provider (OIDC/SAML/SCIM still work alongside).
          A user's <strong>groups</strong> confer roles through the <em>Group → role</em> mapping — e.g. add
          <code> omni-admins</code> to make an admin. Passwords are stored in a separately-keyed encrypted store
          and never shown.
        </p>

        {/* Roster */}
        <div className="space-y-1">
          {data.users.length === 0 && <p className="text-xs text-muted-foreground">No in-app users yet.</p>}
          {data.users.map((u) => (
            <div key={u.id} data-testid={`user-row-${u.userName}`} className="flex flex-wrap items-center gap-2 border border-border p-2 text-xs">
              <span className="font-semibold">{u.displayName}</span>
              <span className="text-muted-foreground font-mono">{u.userName}</span>
              {u.groups.map((g) => <span key={g} className="border px-1.5 py-0.5 text-[10px] uppercase tracking-widest text-muted-foreground">{g}</span>)}
              {!u.active && <span className="border border-amber-500 px-1.5 py-0.5 text-[10px] uppercase tracking-widest text-amber-600">inactive</span>}
              {!u.hasPassword && <span className="border border-amber-500 px-1.5 py-0.5 text-[10px] uppercase tracking-widest text-amber-600">no password</span>}
              <span className="ml-auto flex gap-1">
                <Button type="button" size="sm" variant="outline" onClick={() => void resetPassword(u.id)} data-testid={`user-pw-${u.userName}`}>Set password</Button>
                <Button type="button" size="sm" variant="outline" onClick={() => void toggleActive(u.id, !u.active)}>{u.active ? "Deactivate" : "Activate"}</Button>
                <Button type="button" size="sm" variant="outline" onClick={() => void remove(u.id, u.userName)} data-testid={`user-del-${u.userName}`}>Delete</Button>
              </span>
            </div>
          ))}
        </div>

        {/* Add form */}
        <div className="border-t border-border pt-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input className={input} placeholder="username *" value={userName} onChange={(e) => setUserName(e.target.value)} data-testid="new-user-username" />
            <input className={input} placeholder="display name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            <input className={input} placeholder="email (optional)" value={email} onChange={(e) => setEmail(e.target.value)} />
            <input className={input} placeholder="groups (comma-separated)" value={groups} onChange={(e) => setGroups(e.target.value)} data-testid="new-user-groups" />
            <input className={input} type="password" placeholder="initial password (optional)" value={password} onChange={(e) => setPassword(e.target.value)} data-testid="new-user-password" />
          </div>
          <Button type="button" onClick={() => void add()} disabled={busy || !userName.trim()} data-testid="new-user-add">{busy ? "Adding…" : "Add user"}</Button>
        </div>
      </CardContent>
    </Card>
  );
}
