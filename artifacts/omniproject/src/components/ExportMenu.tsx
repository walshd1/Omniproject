import { Download } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

/** Trigger a file download from a gateway export endpoint (sends the session cookie). */
function download(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * Export menu. With a `projectId` it scopes issue CSV to that project; without
 * one it offers the full-project exports. The workbook (.xlsx) always contains
 * Projects + Issues + Activity.
 */
export function ExportMenu({ projectId, label = "Export" }: { projectId?: string; label?: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex items-center gap-2 border border-border bg-card px-3 py-2 text-xs font-bold uppercase tracking-wider hover:border-primary hover:text-primary"
        data-testid="export-menu"
      >
        <Download className="w-4 h-4" /> {label}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="rounded-none border-border font-mono uppercase text-xs">
        <DropdownMenuItem onSelect={() => download("/api/export.xlsx")}>
          Workbook (.xlsx)
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {projectId ? (
          <DropdownMenuItem onSelect={() => download(`/api/export.csv?dataset=issues&projectId=${encodeURIComponent(projectId)}`)}>
            This project's issues (.csv)
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={() => download("/api/export.csv?dataset=issues")}>
            All issues (.csv)
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => download("/api/export.csv?dataset=projects")}>
          Projects (.csv)
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => download("/api/export.csv?dataset=activity")}>
          Activity (.csv)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
