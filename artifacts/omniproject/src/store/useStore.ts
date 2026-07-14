import { create } from 'zustand'
import type { ViewId } from '../lib/views'
import { DEFAULT_VIEW, isViewId } from '../lib/views'

export interface OmniStore {
  currentView: ViewId
  setCurrentView: (view: ViewId) => void
  isCommandOpen: boolean
  setCommandOpen: (open: boolean | ((open: boolean) => boolean)) => void
  isSettingsOpen: boolean
  setSettingsOpen: (open: boolean) => void
  isNewIssueOpen: boolean
  setNewIssueOpen: (open: boolean) => void
  isNewProjectOpen: boolean
  setNewProjectOpen: (open: boolean) => void
  isShortcutsOpen: boolean
  setShortcutsOpen: (open: boolean) => void
  // A one-shot signal from the command palette: the Settings page scrolls this panel key into view
  // on arrival, then clears it. Lets ⌘K jump straight to any of the ~46 admin panels (2 actions).
  settingsJump: string | null
  setSettingsJump: (key: string | null) => void
  activeProjectId: string | null
  setActiveProjectId: (id: string | null) => void
  aiProvider: 'none' | 'openai' | 'ollama' | 'anthropic' | 'openrouter'
  setAiProvider: (p: string) => void
  theme: 'dark' | 'light'
  toggleTheme: () => void
}

// localStorage access is wrapped: reading/writing it throws (not returns null) in storage-blocked
// contexts — Safari private mode, locked-down enterprise browsers, some webviews. This module runs
// at store-init time, so an unguarded throw here white-screens the whole app before React mounts.
// (The sibling persistence modules — recent-items, prefetch, a11y-prefs — all guard the same way.)
const readLs = (key: string): string | null => {
  try { return typeof window !== 'undefined' ? localStorage.getItem(key) : null } catch { return null }
}
const writeLs = (key: string, value: string): void => {
  try { if (typeof window !== 'undefined') localStorage.setItem(key, value) } catch { /* storage blocked — won't persist */ }
}
const removeLs = (key: string): void => {
  try { if (typeof window !== 'undefined') localStorage.removeItem(key) } catch { /* storage blocked */ }
}

const getInitialTheme = (): 'dark' | 'light' => {
  return readLs('omniproject-theme') === 'light' ? 'light' : 'dark' // default to dark
}

const getInitialView = (): ViewId => {
  const stored = readLs('omniproject-view')
  return stored && isViewId(stored) ? stored : DEFAULT_VIEW
}

const ACTIVE_PROJECT_KEY = 'omniproject-active-project'

const getInitialActiveProjectId = (): string | null => {
  return readLs(ACTIVE_PROJECT_KEY) || null
}

export const useStore = create<OmniStore>((set) => ({
  currentView: getInitialView(),
  setCurrentView: (view) => {
    writeLs('omniproject-view', view)
    set({ currentView: view })
  },
  isCommandOpen: false,
  setCommandOpen: (open) => set((state) => ({ isCommandOpen: typeof open === 'function' ? open(state.isCommandOpen) : open })),
  isSettingsOpen: false,
  setSettingsOpen: (open) => set({ isSettingsOpen: open }),
  isNewIssueOpen: false,
  setNewIssueOpen: (open) => set({ isNewIssueOpen: open }),
  isNewProjectOpen: false,
  setNewProjectOpen: (open) => set({ isNewProjectOpen: open }),
  isShortcutsOpen: false,
  setShortcutsOpen: (open) => set({ isShortcutsOpen: open }),
  settingsJump: null,
  setSettingsJump: (key) => set({ settingsJump: key }),
  activeProjectId: getInitialActiveProjectId(),
  setActiveProjectId: (id) => {
    if (id) writeLs(ACTIVE_PROJECT_KEY, id)
    else removeLs(ACTIVE_PROJECT_KEY)
    set({ activeProjectId: id })
  },
  aiProvider: 'none',
  setAiProvider: (p) => set({ aiProvider: p as 'none' | 'openai' | 'ollama' | 'anthropic' | 'openrouter' }),
  theme: getInitialTheme(),
  toggleTheme: () => set((state) => {
    const newTheme = state.theme === 'dark' ? 'light' : 'dark'
    writeLs('omniproject-theme', newTheme)
    if (typeof window !== 'undefined') {
      if (newTheme === 'dark') {
        document.documentElement.classList.add('dark')
      } else {
        document.documentElement.classList.remove('dark')
      }
    }
    return { theme: newTheme }
  }),
}))
