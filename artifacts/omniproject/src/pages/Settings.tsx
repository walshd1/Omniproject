import {
  useGetSettings,
  useUpdateSettings,
  getGetSettingsQueryKey,
  getGetCapabilitiesQueryKey,
  type SettingsUpdate,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { fetchAiStatus, type AiStatus } from "../lib/ai";
import { PremiumAdmin } from "../components/PremiumAdmin";
import { DataState } from "../components/DataState";
import { LoadingState } from "../components/LoadingState";
import { urlFormatError } from "../lib/validation";

const AI_MODEL_HINT: Record<string, string> = {
  none: "",
  ollama: "Local model name, e.g. llama3.2",
  openrouter: "Public model, e.g. openrouter/auto or anthropic/claude-3.5-sonnet",
  openai: "e.g. gpt-4o-mini",
  anthropic: "e.g. claude-3-5-haiku-latest",
};

export function Settings() {
  const { data: settings, isLoading, isError, error, refetch } = useGetSettings();
  const updateSettings = useUpdateSettings();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [formData, setFormData] = useState({
    brokerUrl: "",
    aiProvider: "none",
    aiModel: "",
    backendSource: "all",
    oidcIssuerUrl: "",
  });
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (settings) {
      setFormData({
        brokerUrl: settings.brokerUrl || "",
        aiProvider: settings.aiProvider || "none",
        aiModel: settings.aiModel || "",
        backendSource: settings.backendSource || "all",
        oidcIssuerUrl: settings.oidcIssuerUrl || "",
      });
    }
  }, [settings]);

  const brokerUrlError = urlFormatError(formData.brokerUrl);
  const oidcUrlError = urlFormatError(formData.oidcIssuerUrl);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (brokerUrlError || oidcUrlError) {
      return;
    }
    const payload: SettingsUpdate = {
      brokerUrl: formData.brokerUrl.trim() || null,
      aiProvider: formData.aiProvider as SettingsUpdate["aiProvider"],
      aiModel: formData.aiModel.trim() || null,
      backendSource: formData.backendSource as SettingsUpdate["backendSource"],
      oidcIssuerUrl: formData.oidcIssuerUrl.trim() || null,
    };
    updateSettings.mutate(
      { data: payload },
      {
        onSuccess: () => {
          // Re-read everything a config change can affect so the UI doesn't show
          // stale settings/capabilities/setup status after save.
          queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
          queryClient.invalidateQueries({ queryKey: ["setup", "status"] });
          queryClient.invalidateQueries({ queryKey: getGetCapabilitiesQueryKey() });
          toast({ title: "SETTINGS SAVED", description: "Integration configured successfully." });
          setAiStatus(null);
        },
        onError: () => {
          toast({ title: "ERROR", description: "Failed to save settings.", variant: "destructive" });
        },
      },
    );
  };

  const testAi = async () => {
    setTesting(true);
    try {
      setAiStatus(await fetchAiStatus());
    } catch {
      toast({ title: "ERROR", description: "Could not reach AI status.", variant: "destructive" });
    } finally {
      setTesting(false);
    }
  };

  if (isLoading) return <LoadingState />;
  if (isError) return <DataState isError error={error} onRetry={() => refetch()} className="p-8 min-h-[16rem]">{null}</DataState>;

  const isAiSelected = formData.aiProvider !== "none";

  return (
    <div className="max-w-2xl mx-auto p-8">
      <h1 className="text-3xl font-black uppercase tracking-tighter mb-8 pb-4 border-b border-border">SYSTEM CONFIGURATION</h1>

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* ── Orchestration ── */}
        <div className="space-y-6 p-6 border border-border bg-card">
          <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground">Orchestration</h2>
          <div className="space-y-2">
            <label htmlFor="broker-url" className="text-sm font-bold uppercase tracking-wider text-muted-foreground block">BROKER URL (n8n)</label>
            <Input
              id="broker-url"
              value={formData.brokerUrl}
              onChange={(e) => setFormData((p) => ({ ...p, brokerUrl: e.target.value }))}
              placeholder="https://n8n.example.com/webhook/..."
              aria-invalid={brokerUrlError ? true : undefined}
              aria-describedby={brokerUrlError ? "broker-url-error" : undefined}
              className="rounded-none border-border font-mono h-12 aria-[invalid=true]:border-red-500"
            />
            {brokerUrlError ? (
              <p id="broker-url-error" role="alert" className="text-xs font-bold text-red-500">{brokerUrlError}</p>
            ) : (
              <p className="text-xs text-muted-foreground">All project data is brokered through this URL (n8n by default).</p>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-bold uppercase tracking-wider text-muted-foreground block">BACKEND</label>
            <Input
              list="backend-suggestions"
              value={formData.backendSource}
              onChange={(e) => setFormData((p) => ({ ...p, backendSource: e.target.value }))}
              placeholder="all"
              className="rounded-none border-border font-mono h-12"
            />
            <datalist id="backend-suggestions">
              <option value="all" />
              <option value="jira" />
              <option value="azure-devops" />
              <option value="servicenow" />
              <option value="github" />
              <option value="monday" />
              <option value="asana" />
              <option value="plane" />
              <option value="openproject" />
            </datalist>
            <p className="text-xs text-muted-foreground">
              Optional routing hint sent to n8n. Use <span className="font-mono">all</span> for any backend n8n is wired
              to, or name a specific system (Jira, Azure DevOps, ServiceNow, …). No specific backend is required.
            </p>
          </div>
        </div>

        {/* ── AI ── */}
        <div className="space-y-6 p-6 border border-border bg-card">
          <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground">AI Model</h2>
          <div className="space-y-2">
            <label className="text-sm font-bold uppercase tracking-wider text-muted-foreground block">PROVIDER</label>
            <Select
              value={formData.aiProvider}
              onValueChange={(v) => setFormData((p) => ({ ...p, aiProvider: v }))}
            >
              <SelectTrigger className="rounded-none border-border h-12 font-mono uppercase">
                <SelectValue placeholder="Select provider" />
              </SelectTrigger>
              <SelectContent className="rounded-none border-border font-mono uppercase">
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="ollama">Local — Ollama</SelectItem>
                <SelectItem value="openrouter">Public — OpenRouter</SelectItem>
                <SelectItem value="openai">OpenAI</SelectItem>
                <SelectItem value="anthropic">Anthropic</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Connect a local model (Ollama) or a public model via OpenRouter. API keys are read from the gateway environment.
            </p>
          </div>

          {isAiSelected && (
            <div className="space-y-2">
              <label className="text-sm font-bold uppercase tracking-wider text-muted-foreground block">MODEL</label>
              <Input
                value={formData.aiModel}
                onChange={(e) => setFormData((p) => ({ ...p, aiModel: e.target.value }))}
                placeholder={AI_MODEL_HINT[formData.aiProvider] || "Default model"}
                className="rounded-none border-border font-mono h-12"
              />
              <div className="flex items-center gap-3 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  onClick={testAi}
                  disabled={testing}
                  className="rounded-none border-border uppercase font-bold tracking-wider text-xs h-9"
                >
                  {testing ? "CHECKING…" : "Test connection"}
                </Button>
                {aiStatus && (
                  <span className={`text-xs font-mono ${aiStatus.configured ? "text-green-500" : "text-amber-500"}`}>
                    {aiStatus.configured ? "● READY" : "● NOT READY"} — {aiStatus.detail}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── Auth ── */}
        <div className="space-y-6 p-6 border border-border bg-card">
          <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground">Identity</h2>
          <div className="space-y-2">
            <label htmlFor="oidc-url" className="text-sm font-bold uppercase tracking-wider text-muted-foreground block">OIDC ISSUER URL</label>
            <Input
              id="oidc-url"
              value={formData.oidcIssuerUrl}
              onChange={(e) => setFormData((p) => ({ ...p, oidcIssuerUrl: e.target.value }))}
              placeholder="https://auth.example.com/..."
              aria-invalid={oidcUrlError ? true : undefined}
              aria-describedby={oidcUrlError ? "oidc-url-error" : undefined}
              className="rounded-none border-border font-mono h-12 aria-[invalid=true]:border-red-500"
            />
            {oidcUrlError && (
              <p id="oidc-url-error" role="alert" className="text-xs font-bold text-red-500">{oidcUrlError}</p>
            )}
          </div>
        </div>

        <Button
          type="submit"
          disabled={updateSettings.isPending || !!brokerUrlError || !!oidcUrlError}
          className="w-full rounded-none border border-primary bg-primary text-primary-foreground hover:bg-primary/90 h-14 font-bold tracking-widest text-lg uppercase"
        >
          {updateSettings.isPending ? "SAVING…" : "COMMIT CHANGES"}
        </Button>
      </form>

      <PremiumAdmin />
    </div>
  );
}
