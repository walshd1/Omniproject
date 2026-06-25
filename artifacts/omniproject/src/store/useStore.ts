import { create } from 'zustand'
import type { ViewId } from '../lib/views'
import { DEFAULT_VIEW, isViewId } from '../lib/views'

export interface OmniStore {
  currentView: ViewId
  setCurrentView: (view: ViewId) => void
  isCommandOpen: boolean
  setCommandOpen: (open: boolean) => void
  isSettingsOpen: boolean
  setSettingsOpen: (open: boolean) => void
  isNewIssueOpen: boolean
  setNewIssueOpen: (open: boolean) => void
  activeProjectId: string | null
  setActiveProjectId: (id: string | null) => void
  aiProvider: 'none' | 'openai' | 'ollama' | 'anthropic' | 'openrouter'
  setAiProvider: (p: string) => void
  theme: 'dark' | 'light'
  toggleTheme: () => void
}

const getInitialTheme = (): 'dark' | 'light' => {
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem('omniproject-theme')
    if (stored === 'light') return 'light'
  }
  return 'dark' // default to dark
}

const getInitialView = (): ViewId => {
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem('omniproject-view')
    if (stored && isViewId(stored)) return stored
  }
  return DEFAULT_VIEW
}

const ACTIVE_PROJECT_KEY = 'omniproject-active-project'

const getInitialActiveProjectId = (): string | null => {
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem(ACTIVE_PROJECT_KEY)
    if (stored) return stored
  }
  return null
}

export const useStore = create<OmniStore>((set) => ({
  currentView: getInitialView(),
  setCurrentView: (view) => {
    if (typeof window !== 'undefined') localStorage.setItem('omniproject-view', view)
    set({ currentView: view })
  },
  isCommandOpen: false,
  setCommandOpen: (open) => set({ isCommandOpen: open }),
  isSettingsOpen: false,
  setSettingsOpen: (open) => set({ isSettingsOpen: open }),
  isNewIssueOpen: false,
  setNewIssueOpen: (open) => set({ isNewIssueOpen: open }),
  activeProjectId: getInitialActiveProjectId(),
  setActiveProjectId: (id) => {
    if (typeof window !== 'undefined') {
      if (id) localStorage.setItem(ACTIVE_PROJECT_KEY, id)
      else localStorage.removeItem(ACTIVE_PROJECT_KEY)
    }
    set({ activeProjectId: id })
  },
  aiProvider: 'none',
  setAiProvider: (p) => set({ aiProvider: p as 'none' | 'openai' | 'ollama' | 'anthropic' | 'openrouter' }),
  theme: getInitialTheme(),
  toggleTheme: () => set((state) => {
    const newTheme = state.theme === 'dark' ? 'light' : 'dark'
    if (typeof window !== 'undefined') {
      localStorage.setItem('omniproject-theme', newTheme)
      if (newTheme === 'dark') {
        document.documentElement.classList.add('dark')
      } else {
        document.documentElement.classList.remove('dark')
      }
    }
    return { theme: newTheme }
  }),
}))
