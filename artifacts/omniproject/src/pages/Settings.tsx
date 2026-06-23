import { useGetSettings, useUpdateSettings, type SettingsUpdate } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useStore } from "../store/useStore";
import { useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";

export function Settings() {
  const { data: settings, isLoading } = useGetSettings();
  const updateSettings = useUpdateSettings();
  const { toast } = useToast();
  
  const [formData, setFormData] = useState({
    n8nWebhookUrl: "",
    aiProvider: "none",
    backendSource: "both",
    oidcIssuerUrl: ""
  });

  useEffect(() => {
    if (settings) {
      setFormData({
        n8nWebhookUrl: settings.n8nWebhookUrl || "",
        aiProvider: settings.aiProvider || "none",
        backendSource: settings.backendSource || "both",
        oidcIssuerUrl: settings.oidcIssuerUrl || ""
      });
    }
  }, [settings]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload: SettingsUpdate = {
      n8nWebhookUrl: formData.n8nWebhookUrl.trim() || null,
      aiProvider: formData.aiProvider as SettingsUpdate["aiProvider"],
      backendSource: formData.backendSource as SettingsUpdate["backendSource"],
      oidcIssuerUrl: formData.oidcIssuerUrl.trim() || null,
    };
    updateSettings.mutate(
      { data: payload },
      {
        onSuccess: () => {
          toast({ title: "SETTINGS SAVED", description: "Integration configured successfully." });
        },
        onError: () => {
          toast({ title: "ERROR", description: "Failed to save settings.", variant: "destructive" });
        }
      }
    );
  };

  if (isLoading) return <div className="p-8 text-center font-bold tracking-widest text-muted-foreground">LOADING...</div>;

  return (
    <div className="max-w-2xl mx-auto p-8">
      <h1 className="text-3xl font-black uppercase tracking-tighter mb-8 pb-4 border-b border-border">SYSTEM CONFIGURATION</h1>
      
      <form onSubmit={handleSubmit} className="space-y-8">
        <div className="space-y-6 p-6 border border-border bg-card">
          <div className="space-y-2">
            <label className="text-sm font-bold uppercase tracking-wider text-muted-foreground block">N8N WEBHOOK URL</label>
            <Input 
              value={formData.n8nWebhookUrl}
              onChange={e => setFormData(p => ({...p, n8nWebhookUrl: e.target.value}))}
              placeholder="https://n8n.example.com/webhook/..."
              className="rounded-none border-border font-mono h-12"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-bold uppercase tracking-wider text-muted-foreground block">BACKEND SOURCE</label>
            <Select value={formData.backendSource} onValueChange={v => setFormData(p => ({...p, backendSource: v}))}>
              <SelectTrigger className="rounded-none border-border h-12 font-mono uppercase">
                <SelectValue placeholder="Select backend" />
              </SelectTrigger>
              <SelectContent className="rounded-none border-border font-mono uppercase">
                <SelectItem value="plane">Plane Only</SelectItem>
                <SelectItem value="openproject">OpenProject Only</SelectItem>
                <SelectItem value="both">Both (Federated)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-bold uppercase tracking-wider text-muted-foreground block">AI PROVIDER</label>
            <Select value={formData.aiProvider} onValueChange={v => setFormData(p => ({...p, aiProvider: v}))}>
              <SelectTrigger className="rounded-none border-border h-12 font-mono uppercase">
                <SelectValue placeholder="Select provider" />
              </SelectTrigger>
              <SelectContent className="rounded-none border-border font-mono uppercase">
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="openai">OpenAI</SelectItem>
                <SelectItem value="anthropic">Anthropic</SelectItem>
                <SelectItem value="ollama">Ollama (Local)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-bold uppercase tracking-wider text-muted-foreground block">OIDC ISSUER URL</label>
            <Input 
              value={formData.oidcIssuerUrl}
              onChange={e => setFormData(p => ({...p, oidcIssuerUrl: e.target.value}))}
              placeholder="https://auth.example.com/..."
              className="rounded-none border-border font-mono h-12"
            />
          </div>
        </div>

        <Button 
          type="submit" 
          disabled={updateSettings.isPending}
          className="w-full rounded-none border border-primary bg-primary text-primary-foreground hover:bg-primary/90 h-14 font-bold tracking-widest text-lg uppercase"
        >
          {updateSettings.isPending ? "SAVING..." : "COMMIT CHANGES"}
        </Button>
      </form>
    </div>
  );
}