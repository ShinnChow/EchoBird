import { create } from 'zustand';
import * as api from '../api/plugins';
import { useNavigationStore } from './navigationStore';
import type { PluginProductState } from '../api/plugins';
const empty = (): PluginProductState => ({
  theme: null,
  palette: null,
  processors: [],
  configuration: {},
  errors: {},
});
interface State {
  snapshot: PluginProductState;
  error: string | null;
  busy: boolean;
  revision: number;
  generation: number;
  load: () => Promise<void>;
  manage: (id: string | null, action: string, key: string, value?: unknown) => Promise<void>;
  execute: (id: string, command: string, input: unknown) => Promise<unknown>;
  reset: () => void;
}
const active = () => useNavigationStore.getState().developerMode;
export const usePluginProductStore = create<State>((set, get) => ({
  snapshot: empty(),
  error: null,
  busy: false,
  revision: 0,
  generation: 0,
  load: async () => {
    if (!active()) return;
    const revision = get().revision + 1;
    set({ revision });
    try {
      const snapshot = await api.getPluginProductState();
      if (active() && get().revision === revision) set({ snapshot, error: null });
    } catch (error) {
      if (get().revision === revision) set({ error: String(error) });
    }
  },
  manage: async (id, action, key, value = null) => {
    if (!active() || get().busy) return;
    const generation = get().generation;
    set({ busy: true, error: null });
    try {
      await api.managePluginProduct(id, action, key, value);
      if (active() && get().generation === generation) await get().load();
    } catch (error) {
      if (active() && get().generation === generation) set({ error: String(error) });
      throw error;
    } finally {
      if (get().generation === generation) set({ busy: false });
    }
  },
  execute: async (id, command, input) => {
    if (!active() || get().busy) return;
    const generation = get().generation;
    set({ busy: true, error: null });
    try {
      const value = await api.executePluginCommand(id, command, input);
      if (!active() || get().generation !== generation) throw new Error('Plugin session is closed');
      return value;
    } catch (error) {
      if (active() && get().generation === generation) set({ error: String(error) });
      throw error;
    } finally {
      if (get().generation === generation) set({ busy: false });
    }
  },
  reset: () =>
    set({
      snapshot: empty(),
      error: null,
      busy: false,
      revision: get().revision + 1,
      generation: get().generation + 1,
    }),
}));

useNavigationStore.subscribe((state, previous) => {
  if (state.developerGeneration !== previous.developerGeneration)
    usePluginProductStore.getState().reset();
});
