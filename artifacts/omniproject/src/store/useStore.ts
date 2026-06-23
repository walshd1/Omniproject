import { create } from 'zustand'

export interface OmniStore {
  currentLens: 'agile' | 'gantt'
  setCurrentLens: (lens: 'agile' | 'gantt') => void
  isCommandOpen: boolean
  setCommandOpen: (open: boolean) => void
  isSettingsOpen: boolean
  setSettingsOpen: (open: boolean) => void
  isNewIssueOpen: boolean
  setNewIssueOpen: (open: boolean) => void
  activeProjectId: string | null
  setActiveProjectId: (id: string | null) => void
  aiProvider: 'none' | 'openai' | 'ollama' | 'anthropic'
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

export const useStore = create<OmniStore>((set) => ({
  currentLens: 'agile',
  setCurrentLens: (lens) => set({ currentLens: lens }),
  isCommandOpen: false,
  setCommandOpen: (open) => set({ isCommandOpen: open }),
  isSettingsOpen: false,
  setSettingsOpen: (open) => set({ isSettingsOpen: open }),
  isNewIssueOpen: false,
  setNewIssueOpen: (open) => set({ isNewIssueOpen: open }),
  activeProjectId: null,
  setActiveProjectId: (id) => set({ activeProjectId: id }),
  aiProvider: 'none',
  setAiProvider: (p) => set({ aiProvider: p as 'none' | 'openai' | 'ollama' | 'anthropic' }),
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
