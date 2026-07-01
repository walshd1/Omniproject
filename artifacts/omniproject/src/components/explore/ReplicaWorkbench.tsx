import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { setFetchInterceptor, getListProjectsUrl, type Project } from "@workspace/api-client-react";
import {
  captureReplica,
  resolveReplica,
  exportReplica,
  newOverlay,
  REPLICA_SCHEMA,
  type ExploreReplica,
} from "../../lib/explore-replica";
import { VIEW_COMPONENTS } from "../views/registry";
import { VIEWS, type ViewId } from "../../lib/views";
import { ErrorBoundary } from "../ErrorBoundary";
import { markExplorationDirty } from "../../lib/exploration";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Camera, Upload, Download, LogOut } from "lucide-react";
import { safeParseJson } from "../../lib/safe-json";

function replicaProjects(r: ExploreReplica): Project[] {
  return (r.responses[getListProjectsUrl()] as Project[] | undefined) ?? [];
}

/** Read a file's text via FileReader (works everywhere, incl. jsdom tests). */
function readText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsText(file);
  });
}

/**
 * Increment 2 of the explore replica: mount the REAL live view components (board,
 * Gantt, Scrum, …) against a captured snapshot. Installing the snapshot
 * interceptor makes every hook resolve from the replica instead of the broker —
 * the same UI you use live, frozen at a point in time and editable in-session
 * (edits land in a volatile overlay, never a backend). Leaving the page clears
 * the interceptor, so the live app is never served stale snapshot data.
 */
export function ReplicaWorkbench() {
  const qc = useQueryClient();
  const [replica, setReplica] = useState<ExploreReplica | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projectId, setProjectId] = useState("");
  const [viewId, setViewId] = useState<ViewId>("kanban");
  const overlay = useRef(newOverlay());

  useEffect(() => {
    if (!replica) {
      setFetchInterceptor(null);
      return;
    }
    overlay.current = newOverlay();
    setFetchInterceptor((req) => resolveReplica(replica, overlay.current, req));
    qc.clear(); // drop any live-cached data so the mounted views read the replica
    markExplorationDirty();
    return () => {
      setFetchInterceptor(null);
      qc.clear(); // and refetch live once we leave replica mode
    };
  }, [replica, qc]);

  const enter = (r: ExploreReplica) => {
    setProjectId(replicaProjects(r)[0]?.id ?? "");
    setViewId("kanban");
    setError(null);
    setReplica(r);
  };

  const capture = async () => {
    setBusy(true);
    setError(null);
    try {
      enter(await captureReplica(`Snapshot ${new Date().toLocaleString()}`));
    } catch {
      setError("Couldn't capture a live snapshot — are you connected?");
    } finally {
      setBusy(false);
    }
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const r = safeParseJson(await readText(file)) as ExploreReplica;
      if (r?.schema !== REPLICA_SCHEMA || !r.responses) throw new Error("bad replica");
      enter(r);
    } catch {
      setError("That isn't a valid replica file.");
    }
  };

  if (!replica) {
    return (
      <section data-testid="replica-workbench" className="border border-blue-500/30 bg-card p-5 space-y-3">
        <h2 className="text-sm font-black uppercase tracking-widest">
          Snapshot-backed live views
          <span className="ml-2 align-middle text-[10px] font-bold uppercase tracking-widest text-blue-500 border border-blue-500/40 px-1.5 py-0.5">
            replica
          </span>
        </h2>
        <p className="text-xs text-muted-foreground">
          Capture the live read-model, then run the real board / Gantt / Scrum views against the
          frozen snapshot — editable in-session, never written to a backend.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" onClick={capture} disabled={busy}
            className="rounded-none uppercase font-bold tracking-wider text-xs h-9 gap-2">
            <Camera className="w-4 h-4" /> {busy ? "Capturing…" : "Capture live snapshot"}
          </Button>
          <label className="inline-flex items-center gap-2 border border-border px-3 h-9 text-xs font-bold uppercase tracking-wider cursor-pointer hover:border-primary">
            <Upload className="w-4 h-4" /> Import replica
            <input type="file" accept="application/json" aria-label="Import replica file" className="hidden"
              onChange={(e) => importFile(e.target.files?.[0])} />
          </label>
        </div>
        {error && <p role="alert" className="text-xs font-bold text-red-500">{error}</p>}
      </section>
    );
  }

  const View = VIEW_COMPONENTS[viewId];
  const projects = replicaProjects(replica);

  return (
    <section data-testid="replica-workbench" className="border border-blue-500/30 bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-black uppercase tracking-widest shrink-0">Replica</span>
          <span className="text-xs text-muted-foreground truncate">
            {replica.label} · captured {new Date(replica.capturedAt).toLocaleString()}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {projects.length > 0 && (
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger aria-label="Replica project" className="w-auto rounded-none border-border text-xs font-bold uppercase h-9 gap-2"><SelectValue /></SelectTrigger>
              <SelectContent className="rounded-none border-border font-bold uppercase">
                {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <Select value={viewId} onValueChange={(v) => setViewId(v as ViewId)}>
            <SelectTrigger aria-label="Replica view" className="w-auto rounded-none border-border text-xs font-bold uppercase h-9 gap-2"><SelectValue /></SelectTrigger>
            <SelectContent className="rounded-none border-border font-bold uppercase">
              {VIEWS.map((v) => <SelectItem key={v.id} value={v.id}>{v.short}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button type="button" variant="outline" onClick={() => exportReplica(replica)}
            className="rounded-none border-border uppercase font-bold tracking-wider text-xs h-9 gap-2">
            <Download className="w-4 h-4" /> Export
          </Button>
          <Button type="button" variant="outline" onClick={() => setReplica(null)}
            className="rounded-none border-border uppercase font-bold tracking-wider text-xs h-9 gap-2">
            <LogOut className="w-4 h-4" /> Exit replica
          </Button>
        </div>
      </div>
      <div data-testid="replica-view" className="h-[600px] p-4">
        {projectId ? (
          <ErrorBoundary fallback={
            <p className="text-sm text-muted-foreground">This view can't render from the snapshot — try another view or recapture.</p>
          }>
            {/* key on view+project so switching remounts cleanly against the replica */}
            <View key={`${viewId}:${projectId}`} projectId={projectId} />
          </ErrorBoundary>
        ) : (
          <p className="text-sm text-muted-foreground">This snapshot has no projects to show.</p>
        )}
      </div>
    </section>
  );
}
