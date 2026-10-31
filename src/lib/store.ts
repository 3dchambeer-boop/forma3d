// =====================================================================
// FORMA-3D Application Store — Zustand
// =====================================================================

'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { translate, type Locale } from './i18n';
import type { User, ViewId } from './types';
import { api } from './api-client';

type Theme = 'dark' | 'light';

interface AppState {
  // Auth
  isAuthenticated: boolean;
  currentUser: User | null;
  authLoading: boolean;
  authError: string | null;

  // UI
  locale: Locale;
  theme: Theme;
  currentView: ViewId;
  selectedProjectId: string | null;
  selectedRevisionId: string | null;
  selectedPrinterId: string | null;
  selectedReviewId: string | null;
  sidebarOpen: boolean;

  // Realtime
  liveConnected: boolean;
  lastEventAt: string | null;

  // Actions
  signIn: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  signOut: () => Promise<void>;
  refreshSession: () => Promise<void>;
  setLocale: (locale: Locale) => void;
  toggleLocale: () => void;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  setView: (view: ViewId) => void;
  selectProject: (id: string | null) => void;
  selectRevision: (id: string | null) => void;
  selectPrinter: (id: string | null) => void;
  selectReview: (id: string | null) => void;
  setSidebarOpen: (open: boolean) => void;
  setLiveConnected: (connected: boolean) => void;
  setLastEventAt: (at: string) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      isAuthenticated: false,
      currentUser: null,
      authLoading: false,
      authError: null,
      locale: 'ar',
      theme: 'dark',
      currentView: 'landing',
      selectedProjectId: null,
      selectedRevisionId: null,
      selectedPrinterId: null,
      selectedReviewId: null,
      sidebarOpen: false,
      liveConnected: false,
      lastEventAt: null,

      signIn: async (email, password) => {
        set({ authLoading: true, authError: null });
        try {
          const { user } = await api.signIn(email, password);
          set({
            isAuthenticated: true,
            currentUser: user,
            locale: user.locale,
            currentView: 'dashboard',
            authLoading: false,
          });
          return { ok: true };
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'Sign in failed';
          set({ authLoading: false, authError: msg });
          return { ok: false, error: msg };
        }
      },

      signOut: async () => {
        try { await api.signOut(); } catch { /* ignore */ }
        set({
          isAuthenticated: false,
          currentUser: null,
          currentView: 'landing',
          selectedProjectId: null,
          selectedRevisionId: null,
          selectedPrinterId: null,
          selectedReviewId: null,
        });
      },

      refreshSession: async () => {
        try {
          const { user } = await api.me();
          set({
            isAuthenticated: true,
            currentUser: user,
            locale: user.locale,
          });
        } catch {
          set({ isAuthenticated: false, currentUser: null });
        }
      },

      setLocale: (locale) => set({ locale }),
      toggleLocale: () => set({ locale: get().locale === 'ar' ? 'en' : 'ar' }),
      setTheme: (theme) => set({ theme }),
      toggleTheme: () => set({ theme: get().theme === 'dark' ? 'light' : 'dark' }),

      setView: (view) => set({ currentView: view, sidebarOpen: false }),
      selectProject: (id) => set({ selectedProjectId: id }),
      selectRevision: (id) => set({ selectedRevisionId: id }),
      selectPrinter: (id) => set({ selectedPrinterId: id }),
      selectReview: (id) => set({ selectedReviewId: id }),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      setLiveConnected: (connected) => set({ liveConnected: connected }),
      setLastEventAt: (at) => set({ lastEventAt: at }),
    }),
    {
      name: 'forma3d-store',
      partialize: (state) => ({
        locale: state.locale,
        theme: state.theme,
        currentView: state.currentView,
      }),
    }
  )
);

// Convenience selector hooks
export function useCurrentUser(): User | null {
  return useAppStore(s => s.currentUser);
}

export function useT() {
  const locale = useAppStore(s => s.locale) as Locale;
  return (key: string, params?: Record<string, string | number>) => translate(locale, key, params);
}
