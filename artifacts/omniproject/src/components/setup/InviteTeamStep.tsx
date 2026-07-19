import { Users, ShieldCheck } from "lucide-react";

/**
 * "Add your team" — how other people get in. OmniProject doesn't store passwords: identities live in your
 * identity provider (OIDC/SAML), and you map IdP groups to OmniProject roles (or provision via SCIM). This
 * step sets that expectation up front and points at the Identity step below, where the SSO + group→role
 * mapping is wired. In demo mode it flags the wide-open posture so a new admin knows to lock it down.
 */
export function InviteTeamStep({ authMode }: { authMode?: "oidc" | "demo" | undefined }) {
  const demo = authMode === "demo";
  return (
    <section className="rounded-lg border border-border bg-card p-5" data-testid="invite-team-step">
      <div className="flex items-center gap-3">
        <Users className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-lg font-bold">Add your team</h2>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        People sign in through your <strong>identity provider</strong> — OmniProject never holds passwords. Create
        accounts (or map groups to roles) in your IdP, or provision users automatically over SCIM.
      </p>
      {demo && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-600" data-testid="invite-team-demo-warning">
          <ShieldCheck className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          You're in <strong>demo mode</strong>: everyone who opens the app is treated as an admin. Connect an identity
          provider (below) before you invite anyone, so access is actually controlled.
        </p>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        Wire SSO and the group → role mapping in the <strong>Identity provider</strong> step below.
      </p>
    </section>
  );
}
