import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getJson } from "../lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Connections (admin) — works out which vendor credentials the broker(s) need for
 * the selected backends and shows a fill-in template for the operator's secret
 * store. By design it NEVER collects a secret value: OmniProject stays stateless;
 * the secret lives with the broker (its env / Docker secret / credential vault).
 */
interface BackendItem { id: string; label: string }
interface RequiredCredential { name: string; secret: boolean; backends: string[] }
interface Connections { credentials: RequiredCredential[]; templates: { env: string; compose: string } }

export function ConnectionsAdmin() {
  const { data: backends } = useQuery<BackendItem[]>({ queryKey: ["setup-backends"], queryFn: () => getJson("/api/setup/backends"), retry: false });
  const [selected, setSelected] = useState<string[]>([]);
  const [format, setFormat] = useState<"env" | "compose">("env");

  const key = useMemo(() => [...selected].sort().join(","), [selected]);
  const { data: conn } = useQuery<Connections>({
    queryKey: ["setup-connections", key],
    queryFn: () => getJson(`/api/setup/connections?backends=${encodeURIComponent(key)}`),
    enabled: selected.length > 0,
    retry: false,
  });

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const [status, setStatus] = useState<Record<string, string>>({});
  const test = async (backend: string) => {
    try {
      const r = await fetch("/api/setup/connections/test", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
        body: JSON.stringify({ backend }),
      });
      const j = await r.json().catch(() => ({}));
      setStatus((s) => ({ ...s, [backend]: r.ok ? (j.ok ? `ok — ${j.detail ?? "reachable"}` : "unreachable") : (j.error ?? "unsupported") }));
    } catch {
      setStatus((s) => ({ ...s, [backend]: "unreachable" }));
    }
  };

  // Optional: relay a secret to the broker's vault (delegate-to-broker option). The
  // value is sent once and NOT stored by OmniProject; we never read it back. Cleared
  // from local state in a `finally` so a network failure can't leave it lingering.
  const [vaultVal, setVaultVal] = useState<Record<string, string>>({});
  const [vaultRef, setVaultRef] = useState<Record<string, string>>({});
  const sendToVault = async (backend: string, name: string) => {
    const value = vaultVal[name] ?? "";
    if (!value) return;
    try {
      const r = await fetch("/api/setup/connections/vault", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
        body: JSON.stringify({ backend, name, value }),
      });
      const j = await r.json().catch(() => ({}));
      setVaultRef((v) => ({ ...v, [name]: r.ok && j.stored ? `stored → ${j.ref ?? "ok"}` : (j.error ?? "failed") }));
    } catch {
      setVaultRef((v) => ({ ...v, [name]: "failed" }));
    } finally {
      setVaultVal((v) => ({ ...v, [name]: "" })); // clear the field even if the request failed
    }
  };

  return (
    <Card data-testid="connections-admin">
      <CardHeader>
        <CardTitle>Connections</CardTitle>
        <p className="text-sm text-muted-foreground">
          Pick the backends in use; this lists the credentials your broker needs and generates a template to fill in your
          secret store. <strong>OmniProject never stores these values</strong> — they live with the broker.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <fieldset className="space-y-1" data-testid="backend-picker">
          <legend className="text-xs uppercase tracking-wider text-muted-foreground">Backends in use</legend>
          {(backends ?? []).map((b) => (
            <label key={b.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={selected.includes(b.id)} onChange={() => toggle(b.id)} data-testid={`backend-${b.id}`} />
              {b.label}
            </label>
          ))}
        </fieldset>

        {selected.length > 0 && (
          <div className="flex flex-wrap gap-2" data-testid="test-connections">
            {selected.map((b) => (
              <span key={b} className="flex items-center gap-1 text-xs">
                <Button size="sm" variant="outline" className="h-6 px-2 py-0 text-xs" onClick={() => test(b)} data-testid={`test-${b}`}>Test {b}</Button>
                {status[b] && <span data-testid={`status-${b}`} className="text-muted-foreground">{status[b]}</span>}
              </span>
            ))}
          </div>
        )}

        {conn && (
          <>
            <table className="w-full text-sm" data-testid="required-credentials">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="py-1 pr-4 font-bold">Credential</th>
                  <th className="py-1 pr-4 font-bold">Type</th>
                  <th className="py-1 pr-4 font-bold">Used by</th>
                  <th className="py-1 pr-4 font-bold">Broker vault (optional)</th>
                </tr>
              </thead>
              <tbody>
                {conn.credentials.map((c) => (
                  <tr key={c.name} className="border-b border-border/50">
                    <td className="py-1 pr-4 font-mono">{c.name}</td>
                    <td className="py-1 pr-4">{c.secret ? <span className="text-amber-600">secret</span> : "config"}</td>
                    <td className="py-1 pr-4">{c.backends.join(", ")}</td>
                    <td className="py-1 pr-4">
                      {c.secret ? (
                        <span className="flex items-center gap-1">
                          <Input
                            type="password"
                            className="h-7 w-40 text-xs"
                            placeholder="send to broker vault"
                            value={vaultVal[c.name] ?? ""}
                            onChange={(e) => setVaultVal((v) => ({ ...v, [c.name]: e.target.value }))}
                            data-testid={`vault-input-${c.name}`}
                          />
                          <Button size="sm" variant="outline" className="h-7 px-2 py-0 text-xs" onClick={() => sendToVault(c.backends[0]!, c.name)} data-testid={`vault-send-${c.name}`}>Send</Button>
                          {vaultRef[c.name] && <span className="text-xs text-muted-foreground" data-testid={`vault-ref-${c.name}`}>{vaultRef[c.name]}</span>}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="flex items-center gap-2">
              <Button size="sm" variant={format === "env" ? "default" : "outline"} onClick={() => setFormat("env")} data-testid="format-env">.env</Button>
              <Button size="sm" variant={format === "compose" ? "default" : "outline"} onClick={() => setFormat("compose")} data-testid="format-compose">compose</Button>
              <Button size="sm" variant="outline" onClick={() => navigator.clipboard?.writeText(conn.templates[format])} data-testid="copy-template">Copy</Button>
            </div>
            <pre className="overflow-x-auto rounded border border-border bg-muted/40 p-3 text-xs" data-testid="credential-template">{conn.templates[format]}</pre>
          </>
        )}
      </CardContent>
    </Card>
  );
}
