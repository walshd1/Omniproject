import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { useAuth, useAuthProviders, login, samlLogin, oauth2Login, requestMagicLink, localLogin, bootstrapFirstAdmin } from "../lib/auth";
import { useBranding } from "../lib/branding";

export function Login() {
  const { data: auth, isLoading } = useAuth();
  const { data: providers } = useAuthProviders();
  const brand = useBranding();
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [magicSent, setMagicSent] = useState(false);
  const [userName, setUserName] = useState("");
  const [password, setPassword] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submitLocal = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setLocalError(null);
    setBusy(true);
    try {
      const r = auth?.needsFirstAdmin ? await bootstrapFirstAdmin(userName, password) : await localLogin(userName, password);
      if (!r.ok) { setLocalError(r.error ?? "Sign-in failed."); return; }
      const dest = "returnTo" in r && typeof r.returnTo === "string" ? r.returnTo : "/";
      window.location.href = dest;
    } finally {
      setBusy(false);
    }
  };

  // Already authenticated → bounce to the dashboard.
  useEffect(() => {
    if (auth?.authenticated) setLocation("/");
  }, [auth, setLocation]);

  const isDemo = auth?.mode === "demo";

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm border-2 border-foreground bg-card p-8 shadow-[8px_8px_0px_0px_rgba(var(--foreground))]">
        <div className="flex justify-center mb-8">
          {brand.logoUrl ? (
            <img src={brand.logoUrl} alt={brand.appName} className="h-16 object-contain" />
          ) : (
            <div className="bg-foreground text-background w-16 h-16 flex items-center justify-center font-black text-2xl border border-foreground">
              {brand.shortName}
            </div>
          )}
        </div>

        <div className="text-center mb-8">
          <h1 className="text-2xl font-black uppercase tracking-tighter mb-2">{brand.appName}</h1>
          <p className="text-sm font-mono text-muted-foreground uppercase tracking-widest">{brand.loginHeading}</p>
        </div>

        {/* Multi-provider: one branded button per configured OIDC provider. In demo mode (no
            providers) a single button enters the local demo session. A single legacy provider
            still renders as one "Sign in with <label>" button. */}
        {providers && providers.length > 0 ? (
          <div className="space-y-3">
            {providers.map((p) => (
              <Button
                key={p.id}
                onClick={() => login("/", p.id)}
                disabled={isLoading}
                className="w-full rounded-none border-2 border-foreground hover:bg-foreground hover:text-background transition-colors font-bold uppercase tracking-wider h-12"
                variant="outline"
              >
                {`SIGN IN WITH ${p.label}`}
              </Button>
            ))}
          </div>
        ) : (
          <Button
            onClick={() => login("/")}
            disabled={isLoading}
            className="w-full rounded-none border-2 border-foreground hover:bg-foreground hover:text-background transition-colors font-bold uppercase tracking-wider h-12"
            variant="outline"
          >
            {isLoading ? "CHECKING…" : isDemo ? "ENTER (DEMO MODE)" : "SIGN IN WITH SSO"}
          </Button>
        )}

        {auth?.samlConfigured && (
          <Button
            onClick={() => samlLogin("/")}
            disabled={isLoading}
            className="w-full mt-3 rounded-none border-2 border-foreground hover:bg-foreground hover:text-background transition-colors font-bold uppercase tracking-wider h-12"
            variant="outline"
          >
            SIGN IN WITH SAML
          </Button>
        )}

        {auth?.oauth2Configured && (
          <Button
            onClick={() => oauth2Login("/")}
            disabled={isLoading}
            className="w-full mt-3 rounded-none border-2 border-foreground hover:bg-foreground hover:text-background transition-colors font-bold uppercase tracking-wider h-12"
            variant="outline"
          >
            SIGN IN WITH OAUTH2
          </Button>
        )}

        {auth?.localSignInEnabled && (
          <form className="mt-4 space-y-2" onSubmit={submitLocal} data-testid="local-login-form">
            {auth.needsFirstAdmin && (
              <p className="text-[11px] text-center text-muted-foreground font-mono leading-relaxed" data-testid="first-admin-note">
                No identity provider is configured. Create the first administrator to get started.
              </p>
            )}
            <input
              type="text"
              required
              autoComplete="username"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              placeholder={auth.needsFirstAdmin ? "choose an admin username" : "username"}
              aria-label="Username"
              data-testid="local-username"
              className="w-full border-2 border-foreground bg-background px-3 py-2 text-sm font-mono outline-none focus:border-primary"
            />
            <input
              type="password"
              required
              autoComplete={auth.needsFirstAdmin ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={auth.needsFirstAdmin ? "choose a password (min 8)" : "password"}
              aria-label="Password"
              data-testid="local-password"
              className="w-full border-2 border-foreground bg-background px-3 py-2 text-sm font-mono outline-none focus:border-primary"
            />
            <Button type="submit" disabled={busy || !userName || !password} variant="outline" className="w-full rounded-none border-2 border-foreground font-bold uppercase tracking-wider h-10">
              {busy ? "…" : auth.needsFirstAdmin ? "Create first admin" : "Sign in"}
            </Button>
            {localError && <p className="text-[11px] text-center text-destructive font-mono" data-testid="local-login-error">{localError}</p>}
          </form>
        )}

        {auth?.magicLinkEnabled && (
          <form
            className="mt-4 space-y-2"
            onSubmit={async (e) => { e.preventDefault(); await requestMagicLink(email, "/"); setMagicSent(true); }}
          >
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.org"
              aria-label="Email for a sign-in link"
              className="w-full border-2 border-foreground bg-background px-3 py-2 text-sm font-mono outline-none focus:border-primary"
            />
            <Button type="submit" disabled={isLoading || !email} variant="outline" className="w-full rounded-none border-2 border-foreground font-bold uppercase tracking-wider h-10">
              Email me a sign-in link
            </Button>
            {magicSent && (
              <p className="text-[11px] text-center text-muted-foreground font-mono">
                If that address can sign in, a link is on its way. Check your inbox.
              </p>
            )}
          </form>
        )}

        {isDemo && (
          <p className="mt-4 text-[11px] text-center text-muted-foreground font-mono leading-relaxed">
            No OIDC provider configured. Set OIDC_ISSUER_URL, OIDC_CLIENT_ID and
            OIDC_CLIENT_SECRET to enforce SSO.
          </p>
        )}

        <div className="mt-8 pt-8 border-t-2 border-border text-center">
          <p className="text-xs text-muted-foreground font-mono">{brand.footerText || "SECURE. FAST. KEYBOARD DRIVEN."}</p>
        </div>
      </div>
    </div>
  );
}
