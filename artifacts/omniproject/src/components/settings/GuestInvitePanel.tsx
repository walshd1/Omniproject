import { useState } from "react";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AdminSection } from "./AdminSection";
import { useToast } from "@/hooks/use-toast";
import { useListProjects } from "@workspace/api-client-react";
import { useAuth, roleAtLeast } from "../../lib/auth";
import { useInviteGuest, type GuestTier } from "../../lib/portal";

/**
 * Guest invite (manager+) — invite an external client into ONE project's read-only status portal via a
 * single-use magic-link. The server re-enforces everything (manager+, the inviter's own scope over the
 * project, GUEST_PORTAL_ENABLED); this panel is just the convenience form. The guest that results is
 * confined to that project and can see nothing else in the app.
 */
export function GuestInvitePanel() {
  const { data: auth } = useAuth();
  const { data: projects } = useListProjects();
  const invite = useInviteGuest();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [projectId, setProjectId] = useState("");
  const [tier, setTier] = useState<GuestTier>("read");

  // Managers and above may invite; a contributor/viewer never sees this panel (server also gates).
  if (!roleAtLeast(auth?.role, "manager")) return null;

  const list = Array.isArray(projects) ? projects : [];
  const canSend = /\S+@\S+\.\S+/.test(email) && !!projectId && !invite.isPending;

  const send = () => {
    invite.mutate(
      { email: email.trim(), projectId, tier },
      {
        onSuccess: (r) => {
          setEmail("");
          toast({
            title: "INVITE SENT",
            description: r.link ? `Dev link: ${r.link}` : `A portal invite was emailed to ${email.trim()}.`,
          });
        },
        onError: (e) => toast({ title: "COULD NOT INVITE", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" }),
      },
    );
  };

  return (
    <AdminSection icon={UserPlus} title="Invite a client (guest portal)" testId="guest-invite-admin">
      <p className="text-xs text-muted-foreground">
        Give an external client a read-only status view of ONE project. They sign in with a single-use link
        and see only that project's progress and milestones — never the portfolio, costs, or admin surfaces.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto_auto] gap-2 items-center">
        <Input
          type="email"
          aria-label="Client email"
          data-testid="guest-invite-email"
          placeholder="client@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="h-9"
        />
        <select
          aria-label="Project"
          data-testid="guest-invite-project"
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          className="h-9 bg-background border border-border text-sm px-2 rounded-none"
        >
          <option value="">Select a project…</option>
          {list.map((p) => (
            <option key={String(p.id)} value={String(p.id)}>{String(p.name ?? p.id)}</option>
          ))}
        </select>
        <select
          aria-label="Access tier"
          data-testid="guest-invite-tier"
          value={tier}
          onChange={(e) => setTier(e.target.value as GuestTier)}
          className="h-9 bg-background border border-border text-sm px-2 rounded-none"
        >
          <option value="read">Read only</option>
          <option value="comment">Read &amp; comment</option>
        </select>
        <Button type="button" size="sm" className="h-9" onClick={send} disabled={!canSend} data-testid="guest-invite-send">
          {invite.isPending ? "Sending…" : "Send invite"}
        </Button>
      </div>
    </AdminSection>
  );
}
