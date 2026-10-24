import { create } from 'zustand';
import * as api from '../api/voiceInput';
import type { ModelConfig } from '../api/types';

export const voiceBusy = (phase?: string) =>
  ['starting', 'recording', 'testing', 'transcribing', 'optimizing', 'inserting'].includes(
    phase ?? ''
  );

interface VoiceInputState {
  models: ModelConfig[];
  snapshot: api.VoiceSnapshot | null;
  devices: string[];
  saving: boolean;
  pending: boolean;
  error: string | null;
  accept: (snapshot: api.VoiceSnapshot) => void;
  load: () => Promise<void>;
  save: (changes: Partial<api.VoiceConfig>) => Promise<boolean>;
  start: () => Promise<void>;
  record: () => Promise<void>;
  stop: () => Promise<void>;
  cancel: () => Promise<void>;
}

export const useVoiceInputStore = create<VoiceInputState>((set, get) => ({
  models: [],
  snapshot: null,
  devices: [],
  saving: false,
  pending: false,
  error: null,
  accept: (snapshot) =>
    set((state) =>
      !state.snapshot || snapshot.revision >= state.snapshot.revision ? { snapshot } : {}
    ),
  load: async () => {
    const results = await Promise.allSettled([api.getVoiceState(), api.getVoiceDevices()]);
    if (results[0].status === 'fulfilled') get().accept(results[0].value);
    else if (!get().snapshot) set({ error: 'voice.error.config' });
    if (results[1].status === 'fulfilled') set({ devices: results[1].value });
  },
  save: async (changes) => {
    const { snapshot, saving, pending } = get();
    if (!snapshot || saving || pending || voiceBusy(snapshot.phase)) return false;
    set({ saving: true, error: null });
    try {
      const config = { ...snapshot.config, ...changes };
      if (!config.channels.length) config.shortcutEnabled = false;
      get().accept(await api.saveVoiceConfig(config));
      return true;
    } catch (error) {
      set({ error: String(error) });
      return false;
    } finally {
      set({ saving: false });
    }
  },
  start: async () => {
    if (get().pending || get().saving || voiceBusy(get().snapshot?.phase)) return;
    set({ pending: true, error: null });
    try {
      get().accept(await api.startVoice());
    } catch (error) {
      set({ error: String(error) });
    } finally {
      set({ pending: false });
    }
  },
  record: async () => {
    if (
      !get().snapshot?.config.shortcutEnabled ||
      get().pending ||
      get().saving ||
      voiceBusy(get().snapshot?.phase)
    )
      return;
    set({ pending: true, error: null });
    try {
      get().accept(await api.recordVoice());
    } catch (error) {
      set({ error: String(error) });
    } finally {
      set({ pending: false });
    }
  },
  stop: async () => {
    if (!['recording', 'testing'].includes(get().snapshot?.phase ?? '') || get().pending) return;
    set({ pending: true, error: null });
    try {
      get().accept(await api.stopVoice());
    } catch (error) {
      set({ error: String(error) });
    } finally {
      set({ pending: false });
    }
  },
  cancel: async () => {
    try {
      get().accept(await api.cancelVoice());
    } catch (error) {
      set({ error: String(error) });
    }
  },
}));
