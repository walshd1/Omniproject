import { useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { useAuth, login, samlLogin } from "../lib/auth";
import { useBranding } from "../lib/branding";

export function Login() {
  const { data: auth, isLoading } = useAuth();
  const brand = useBranding();
  const [, setLocation] = useLocation();

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

        <Button
          onClick={() => login("/")}
          disabled={isLoading}
          className="w-full rounded-none border-2 border-foreground hover:bg-foreground hover:text-background transition-colors font-bold uppercase tracking-wider h-12"
          variant="outline"
        >
          {isLoading ? "CHECKING…" : isDemo ? "ENTER (DEMO MODE)" : "SIGN IN WITH SSO"}
        </Button>

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
