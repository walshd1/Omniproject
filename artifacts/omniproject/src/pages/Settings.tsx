import {
  useGetSettings,
  useUpdateSettings,
  getGetSettingsQueryKey,
  getGetCapabilitiesQueryKey,
  type SettingsUpdate,
} from "@workspace/api-client-react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { fetchAiStatus, type AiStatus } from "../lib/ai";
import { fetchBackends } from "../lib/setup";
import { PremiumAdmin } from "../components/PremiumAdmin";
import { LoggingSyncSettings } from "../components/settings/LoggingSyncSettings";
import { TranslationLayer } from "../components/settings/TranslationLayer";
import { BrokerLog } from "../components/settings/BrokerLog";
import { A11yControls } from "../components/settings/A11yControls";
import { PerformanceSettings } from "../components/settings/PerformanceSettings";
import { GovernanceAdmin } from "../components/settings/GovernanceAdmin";
import { ActionCatalogue } from "../components/settings/ActionCatalogue";
import { AiProvidersAdmin } from "../components/settings/AiProvidersAdmin";
import { GovernanceDashboard } from "../components/settings/GovernanceDashboard";
import { DeploymentProfile } from "../components/settings/DeploymentProfile";
import { FeatureModulesAdmin } from "../components/settings/FeatureModulesAdmin";
import { RateCardAdmin } from "../components/settings/RateCardAdmin";
import { RateGridAdmin } from "../components/settings/RateGridAdmin";
import { IdentityMapAdmin } from "../components/settings/IdentityMapAdmin";
import { FeatureGovernance } from "../components/settings/FeatureGovernance";
import { FieldVisibilityAdmin } from "../components/settings/FieldVisibilityAdmin";
import { SecurityKeys } from "../components/settings/SecurityKeys";
import { ProvenanceDashboard } from "../components/settings/ProvenanceDashboard";
import { NlCommand } from "../components/settings/NlCommand";
import { HealthWatch } from "../components/settings/HealthWatch";
import { Copilot } from "../components/settings/Copilot";
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
  // Backend-source suggestions come from the catalogue (admin-filtered server-side), so no
  // vendor ids are hardcoded in the SPA. "all" (no-filter) is the only built-in suggestion.
  const { data: backends } = useQuery({ queryKey: ["setup-backends"], queryFn: fetchBackends, staleTime: 60_000 });

  const [formData, setFormData] = useState({
    brokerUrl: "",
    aiProvider: "none",
    sttProvider: "none",
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
        sttProvider: settings.sttProvider || "none",
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
      aiProvider: formData.aiProvider as NonNullable<SettingsUpdate["aiProvider"]>,
      sttProvider: formData.sttProvider as NonNullable<SettingsUpdate["sttProvider"]>,
      aiModel: formData.aiModel.trim() || null,
      backendSource: formData.backendSource as NonNullable<SettingsUpdate["backendSource"]>,
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
            <label htmlFor="broker-url" className="text-sm font-bold uppercase tracking-wider text-muted-foreground block">BROKER URL</label>
            <Input
              id="broker-url"
              value={formData.brokerUrl}
              onChange={(e) => setFormData((p) => ({ ...p, brokerUrl: e.target.value }))}
              placeholder="https://broker.example.com/webhook/..."
              aria-invalid={brokerUrlError ? true : undefined}
              aria-describedby={brokerUrlError ? "broker-url-error" : undefined}
              className="rounded-none border-border font-mono h-12 aria-[invalid=true]:border-red-500"
            />
            {brokerUrlError ? (
              <p id="broker-url-error" role="alert" className="text-xs font-bold text-red-500">{brokerUrlError}</p>
            ) : (
              <p className="text-xs text-muted-foreground">All project data is brokered through this URL.</p>
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
              {(backends ?? []).map((b) => <option key={b.id} value={b.id} />)}
            </datalist>
            <p className="text-xs text-muted-foreground">
              Optional routing hint sent to the broker. Use <span className="font-mono">all</span> for any backend the broker is wired
              to, or pick a specific backend id from the suggestions. No specific backend is required.
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

          <div className="space-y-2 pt-2 border-t border-border">
            <label className="text-sm font-bold uppercase tracking-wider text-muted-foreground block">SPEECH-TO-TEXT</label>
            <Select
              value={formData.sttProvider}
              onValueChange={(v) => setFormData((p) => ({ ...p, sttProvider: v }))}
            >
              <SelectTrigger className="rounded-none border-border h-12 font-mono uppercase">
                <SelectValue placeholder="Select engine" />
              </SelectTrigger>
              <SelectContent className="rounded-none border-border font-mono uppercase">
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="browser">On-device — Browser (no egress)</SelectItem>
                <SelectItem value="whisper">AI-assisted — Whisper</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Dictation engine. <span className="font-mono">Browser</span> transcribes on the device — audio never
              leaves the machine. <span className="font-mono">Whisper</span> is AI-assisted (audio is uploaded), so it
              is governance-gated and honours the AI kill switch. The Whisper endpoint/key are read from the gateway
              environment.
            </p>
          </div>
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

      <div className="mt-10">
        <LoggingSyncSettings />
      </div>

      <div className="mt-10">
        <TranslationLayer />
      </div>

      <div className="mt-10">
        <BrokerLog />
      </div>

      <PremiumAdmin />

      <div className="mt-10">
        <SecurityKeys />
      </div>

      <div className="mt-10">
        <NlCommand />
      </div>

      <div className="mt-10">
        <HealthWatch />
      </div>

      <div className="mt-10">
        <Copilot />
      </div>

      <div className="mt-10">
        <ProvenanceDashboard />
      </div>

      <div className="mt-10">
        <DeploymentProfile />
      </div>

      <div className="mt-10">
        <FeatureModulesAdmin />
      </div>

      <div className="mt-10">
        <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground mb-4">Feature governance (org · programme · project)</h2>
        <FeatureGovernance />
      </div>

      <div className="mt-10">
        <RateCardAdmin />
      </div>

      <div className="mt-10">
        <RateGridAdmin />
      </div>

      <div className="mt-10">
        <IdentityMapAdmin />
      </div>

      <div className="mt-10">
        <FieldVisibilityAdmin />
      </div>

      <div className="mt-10">
        <GovernanceDashboard />
      </div>

      <div className="mt-10">
        <GovernanceAdmin />
      </div>

      <div className="mt-10">
        <AiProvidersAdmin />
      </div>

      <div className="mt-10">
        <ActionCatalogue />
      </div>

      <A11yControls />

      <div className="mt-10">
        <PerformanceSettings />
      </div>
    </div>
  );
}
