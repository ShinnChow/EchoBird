// Navigation store — cross-page navigation state & app-wide signals
// Replaces: onGoToMother, onAgentRunningChange, onNewMessage callbacks
// Replaces: page-activated CustomEvent, ssh-servers-changed CustomEvent
// Used by: App.tsx, AppManagerProvider, MotherAgentProvider, SidebarConnected

import { create } from 'zustand';
import type { PageType } from '../components';

interface NavigationState {
  activePage: PageType;
  backHistory: PageType[];
  forwardHistory: PageType[];
  motherPrefill: string | undefined;
  motherPrefillCursor: number | undefined;
  agentRunning: boolean;
  updateAvailable: string | null;

  // SSH servers version counter (replaces 'ssh-servers-changed' CustomEvent)
  sshServersVersion: number;

  setActivePage: (page: PageType) => void;
  goBack: () => void;
  goForward: () => void;
  goToMother: (prefill: string, cursor?: number) => void;
  clearMotherPrefill: () => void;
  setAgentRunning: (running: boolean) => void;
  setUpdateAvailable: (v: string | null) => void;
  bumpSshServersVersion: () => void;
}

function visitPage(state: NavigationState, page: PageType): Partial<NavigationState> {
  if (state.activePage === page) return state;
  return {
    activePage: page,
    backHistory: [...state.backHistory, state.activePage],
    forwardHistory: [],
    motherPrefill: undefined,
    motherPrefillCursor: undefined,
  };
}

export const useNavigationStore = create<NavigationState>((set) => ({
  activePage: 'apps',
  backHistory: [],
  forwardHistory: [],
  motherPrefill: undefined,
  motherPrefillCursor: undefined,
  agentRunning: false,
  updateAvailable: null,
  sshServersVersion: 0,

  setActivePage: (page) => set((state) => visitPage(state, page)),
  goBack: () =>
    set((state) => {
      const page = state.backHistory[state.backHistory.length - 1];
      if (!page) return state;
      return {
        activePage: page,
        backHistory: state.backHistory.slice(0, -1),
        forwardHistory: [...state.forwardHistory, state.activePage],
        motherPrefill: undefined,
        motherPrefillCursor: undefined,
      };
    }),
  goForward: () =>
    set((state) => {
      const page = state.forwardHistory[state.forwardHistory.length - 1];
      if (!page) return state;
      return {
        activePage: page,
        backHistory: [...state.backHistory, state.activePage],
        forwardHistory: state.forwardHistory.slice(0, -1),
        motherPrefill: undefined,
        motherPrefillCursor: undefined,
      };
    }),
  goToMother: (prefill, cursor) =>
    set((state) => ({
      ...visitPage(state, 'mother'),
      motherPrefill: prefill,
      motherPrefillCursor: cursor,
    })),
  // One-shot consume: MotherAgentProvider clears this right after it fills
  // the chat input, so revisiting the Mother page doesn't re-fill a stale
  // "安装XX" prompt the user already sent or cleared.
  clearMotherPrefill: () => set({ motherPrefill: undefined, motherPrefillCursor: undefined }),
  setAgentRunning: (running) => set({ agentRunning: running }),
  setUpdateAvailable: (v) => set({ updateAvailable: v }),
  bumpSshServersVersion: () => set((s) => ({ sshServersVersion: s.sshServersVersion + 1 })),
}));
