import { useEffect } from 'react';
import { create } from 'zustand';

const STORAGE_KEY = 'echobird-account-proxy-risk-acknowledged';

interface AccountAccessRiskState {
  acknowledged: boolean;
  hydrated: boolean;
  hydrate: () => void;
  setAcknowledged: (acknowledged: boolean) => void;
}

export const useAccountAccessRiskStore = create<AccountAccessRiskState>((set, get) => ({
  acknowledged: false,
  hydrated: false,
  hydrate: () => {
    if (get().hydrated) return;
    let acknowledged = false;
    try {
      acknowledged = localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
      // An unavailable preference starts unacknowledged.
    }
    set({ acknowledged, hydrated: true });
  },
  setAcknowledged: (acknowledged) => {
    set({ acknowledged, hydrated: true });
    try {
      localStorage.setItem(STORAGE_KEY, String(acknowledged));
    } catch {
      // Keep both views in sync even when persistence is unavailable.
    }
  },
}));

export function useAccountAccessRisk() {
  const state = useAccountAccessRiskStore();
  const { hydrate } = state;
  useEffect(() => hydrate(), [hydrate]);
  return state;
}
