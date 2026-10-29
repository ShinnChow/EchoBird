import { create } from 'zustand';

// Both controls reflect the same saved setting. Request payloads never enter this store.
export const useProtectionStore = create<{
  enabled: boolean | null;
  revision: number;
  pending: boolean;
  saveError: boolean;
  publish: (enabled: boolean) => void;
}>((set) => ({
  enabled: null,
  revision: 0,
  pending: false,
  saveError: false,
  publish: (enabled) => set((state) => ({ enabled, revision: state.revision + 1 })),
}));
