import { useEffect } from "react";
import { useUndoRedo } from "../lib/use-undo-redo";

/**
 * Global undo/redo keyboard layer for issue field edits: Ctrl/Cmd+Z undoes the last edit, Shift+Ctrl/Cmd+Z
 * (or Ctrl/Cmd+Y) redoes it. Renders nothing. Deliberately ignores the shortcut while the user is typing in
 * a text field / contenteditable, so native text-undo keeps working inside inputs and the app-level undo only
 * fires from the surrounding UI. Mounted once at the app shell.
 */
function isTextEntry(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

export function UndoRedoHotkeys() {
  const { undo, redo } = useUndoRedo();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || isTextEntry(e.target)) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((k === "z" && e.shiftKey) || k === "y") { e.preventDefault(); redo(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [undo, redo]);
  return null;
}
