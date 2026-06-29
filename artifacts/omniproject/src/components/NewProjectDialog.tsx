import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateProject,
  useListProgrammes,
  getListProjectsQueryKey,
  getListProgrammesQueryKey,
  type ProjectInput,
} from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useFormDialog } from "../hooks/use-form-dialog";

/**
 * Create a project through the broker (RFC-001 §2). Only rendered when the
 * backend can store projects (capabilities.entities.project.store) — the gating
 * lives at the call site. Setting a Programme here is the derived-programme
 * grouping: name an existing or new programme and the project joins it.
 */
export function NewProjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const create = useCreateProject();
  const { data: programmes } = useListProgrammes();
  const { form, setForm, reset, close: resetOnClose } = useFormDialog({ name: "", identifier: "", description: "", programmeId: "" });

  const nameError = form.name.trim() ? "" : "Name is required";
  const close = (o: boolean) => {
    resetOnClose(o);
    onOpenChange(o);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (nameError) return;
    const data: ProjectInput = {
      name: form.name.trim(),
      identifier: form.identifier.trim() || null,
      description: form.description.trim() || null,
      programmeId: form.programmeId.trim() || null,
    };
    create.mutate(
      { data },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListProjectsQueryKey() });
          qc.invalidateQueries({ queryKey: getListProgrammesQueryKey() });
          toast({ title: "PROJECT CREATED", description: `${data.name} was created.` });
          reset();
          onOpenChange(false);
        },
        onError: () => toast({ title: "ERROR", description: "Could not create the project.", variant: "destructive" }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="rounded-none border-border">
        <DialogHeader>
          <DialogTitle className="uppercase tracking-tighter">New Project</DialogTitle>
          <DialogDescription>Created in your backend through the broker, as you.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="np-name" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Name</label>
            <Input
              id="np-name"
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              aria-invalid={form.name.length > 0 && !!nameError ? true : undefined}
              className="rounded-none border-border font-mono h-11"
              placeholder="Apollo Platform"
            />
            {form.name.length > 0 && nameError && (
              <p role="alert" className="text-xs font-bold text-red-500">{nameError}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="np-id" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Identifier <span className="font-normal lowercase">(optional)</span></label>
            <Input id="np-id" value={form.identifier} onChange={(e) => setForm((p) => ({ ...p, identifier: e.target.value }))}
              className="rounded-none border-border font-mono h-11" placeholder="APOLLO" />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="np-desc" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Description <span className="font-normal lowercase">(optional)</span></label>
            <Input id="np-desc" value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              className="rounded-none border-border font-mono h-11" />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="np-prog" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Programme <span className="font-normal lowercase">(optional — pick or name a new one)</span></label>
            <Input id="np-prog" list="np-programmes" value={form.programmeId}
              onChange={(e) => setForm((p) => ({ ...p, programmeId: e.target.value }))}
              className="rounded-none border-border font-mono h-11" placeholder="None (standalone project)" />
            <datalist id="np-programmes">
              {(programmes ?? []).map((pr) => (
                <option key={pr.id} value={pr.id}>{pr.name}</option>
              ))}
            </datalist>
            <p className="text-[11px] text-muted-foreground">Joining a programme groups this project under it. A new name creates the programme.</p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => close(false)} className="rounded-none border-border uppercase font-bold tracking-wider text-xs">Cancel</Button>
            <Button type="submit" disabled={!!nameError || create.isPending}
              className="rounded-none uppercase font-bold tracking-wider text-xs">
              {create.isPending ? "Creating…" : "Create project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
