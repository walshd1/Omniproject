import { useEffect, useState } from "react";
import { useStore } from "../store/useStore";

/**
 * The active-project selector state shared by every page that lets the operator pick a project to
 * scope its content by (Reports, Content pages): seed from the store's remembered active project,
 * default to the first project once the list loads, and keep the store in sync on every pick.
 */
export function useActiveProjectSelector(projects: readonly { id: string }[] | undefined) {
  const { activeProjectId, setActiveProjectId } = useStore();
  const [projectId, setProjectId] = useState(activeProjectId || "");

  useEffect(() => {
    if (!projectId && projects && projects.length > 0) {
      setProjectId(activeProjectId || projects[0]!.id); // length > 0 checked above
    }
  }, [projects, projectId, activeProjectId]);

  const onSelect = (id: string) => {
    setProjectId(id);
    setActiveProjectId(id);
  };

  return { projectId, onSelect };
}
