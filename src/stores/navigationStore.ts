// Navigation store — cross-page navigation state & app-wide signals
// Replaces: onGoToMother, onAgentRunningChange, onNewMessage callbacks
// Replaces: page-activated CustomEvent, ssh-servers-changed CustomEvent
// Used by: App.tsx, AppManagerProvider, MotherAgentProvider, SidebarConnected

import { create } from 'zustand';
import type { PageType } from '../components';

interface NavigationState {
  activePage: PageType;
  motherPrefill: string | undefined;
  agentRunning: boolean;
  updateAvailable: string | null;

  // SSH servers version counter (replaces 'ssh-servers-changed' CustomEvent)
  sshServersVersion: number;

  setActivePage: (page: PageType) => void;
  goToMother: (prefill: string) => void;
  clearMotherPrefill: () => void;
  setAgentRunning: (running: boolean) => void;
  setUpdateAvailable: (v: string | null) => void;
  bumpSshServersVersion: () => void;
}

export const useNavigationStore = create<NavigationState>((set) => ({
  activePage: 'apps',
  motherPrefill: undefined,
  agentRunning: false,
  updateAvailable: null,
  sshServersVersion: 0,

  setActivePage: (page) => set({ activePage: page }),
  goToMother: (prefill) => set({ activePage: 'mother', motherPrefill: prefill }),
  // One-shot consume: MotherAgentProvider clears this right after it fills
  // the chat input, so revisiting the Mother page doesn't re-fill a stale
  // "安装XX" prompt the user already sent or cleared.
  clearMotherPrefill: () => set({ motherPrefill: undefined }),
  setAgentRunning: (running) => set({ agentRunning: running }),
  setUpdateAvailable: (v) => set({ updateAvailable: v }),
  bumpSshServersVersion: () => set((s) => ({ sshServersVersion: s.sshServersVersion + 1 })),
}));
