import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Section, LockNotice, Field } from "./shared";

/**
 * Outbound webhooks panel — register HMAC-signed delivery endpoints for events (notifications,
 * audit, config changes) and test them. Gated by the `webhooks` licence entitlement. Part of the
 * premium overlay admin.
 */

interface Webhook { id: string; url: string; events: string[]; active: boolean; description?: string; secretSet: boolean; }

export function WebhooksAdmin({ entitled }: { entitled: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState("*");
  const [description, setDescription] = useState("");
  const [revealed, setRevealed] = useState<{ id: string; secret: string } | null>(null);

  const { data } = useQuery<{ entitled: boolean; events: string[]; webhooks: Webhook[] }>({
    queryKey: ["webhooks"],
    queryFn: async () => (await fetch("/api/webhooks", { credentials: "same-origin" })).json(),
    staleTime: 0,
  });
  const hooks = data?.webhooks ?? [];

  const add = async () => {
    try {
      const res = await fetch("/api/webhooks", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, events: events.split(",").map((s) => s.trim()).filter(Boolean), description }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setRevealed({ id: json.webhook.id, secret: json.webhook.secret });
      setUrl(""); setDescription(""); setEvents("*");
      qc.invalidateQueries({ queryKey: ["webhooks"] });
      toast({ title: "WEBHOOK ADDED", description: "Copy the signing secret now — it won't be shown again." });
    } catch (e) {
      toast({ title: "ERROR", description: String(e instanceof Error ? e.message : e), variant: "destructive" });
    }
  };

  const remove = async (id: string) => {
    try {
      const res = await fetch(`/api/webhooks/${id}`, { method: "DELETE", credentials: "same-origin" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      qc.invalidateQueries({ queryKey: ["webhooks"] });
      toast({ title: "WEBHOOK DELETED", description: "Deliveries to this endpoint have stopped." });
    } catch (e) {
      toast({ title: "ERROR", description: String(e instanceof Error ? e.message : e), variant: "destructive" });
    }
  };

  const test = async (id: string) => {
    const res = await fetch(`/api/webhooks/${id}/test`, { method: "POST", credentials: "same-origin" });
    const json = await res.json();
    const r = json.result;
    toast({
      title: r?.ok ? "TEST DELIVERED" : "TEST FAILED",
      description: r ? `HTTP ${r.status} in ${r.ms}ms${r.error ? ` — ${r.error}` : ""}` : json.error,
      variant: r?.ok ? undefined : "destructive",
    });
  };

  return (
    <Section title="Outbound webhooks">
      {!entitled && <LockNotice feature="webhooks" />}
      <p className="text-xs text-muted-foreground">Push events (notifications, audit, config changes) to a customer endpoint, SIEM, Slack or an n8n webhook node. Each delivery is HMAC-signed with the subscription secret (header <code>X-OmniProject-Signature</code>).</p>

      {hooks.length > 0 && (
        <div className="space-y-2">
          {hooks.map((h) => (
            <div key={h.id} className="flex items-center gap-3 border border-border p-3 text-xs font-mono">
              <span className={`w-2 h-2 rounded-full ${h.active ? "bg-green-500" : "bg-muted-foreground"}`} />
              <div className="flex-1 min-w-0">
                <div className="truncate">{h.url}</div>
                <div className="text-muted-foreground">{h.events.join(", ")}{h.description ? ` · ${h.description}` : ""}</div>
              </div>
              <Button type="button" variant="outline" disabled={!entitled} onClick={() => test(h.id)} className="rounded-none border-border h-8 text-xs uppercase">Test</Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <button type="button" className="text-muted-foreground hover:text-destructive" aria-label="Delete webhook"><Trash2 className="w-4 h-4" /></button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete webhook?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Deliveries to <span className="font-mono break-all">{h.url}</span> will stop immediately and the
                      signing secret is destroyed. This cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => remove(h.id)} className="bg-red-500 text-background hover:bg-red-600">Delete</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          ))}
        </div>
      )}

      {revealed && (
        <div className="border border-green-500/40 bg-green-500/10 p-3 text-xs font-mono space-y-1">
          <div className="font-bold uppercase">Signing secret (shown once)</div>
          <code className="break-all">{revealed.secret}</code>
        </div>
      )}

      <fieldset disabled={!entitled} className="space-y-3 disabled:opacity-50">
        <Field label="Endpoint URL" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://hooks.acme.com/omni" />
        <Field label="Events" value={events} onChange={(e) => setEvents(e.target.value)} placeholder="*" hint={`Comma-separated, or * for all. Known: ${(data?.events ?? []).join(", ")}`} />
        <Field label="Description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="SIEM forwarder" />
        <Button type="button" onClick={add} disabled={!entitled || !url} className="rounded-none uppercase font-bold tracking-wider">Add webhook</Button>
      </fieldset>
    </Section>
  );
}
