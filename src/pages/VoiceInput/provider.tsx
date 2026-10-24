import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useNavigationStore } from '../../stores/navigationStore';
import { useToolsStore } from '../../stores/toolsStore';
import { useVoiceInputStore, voiceBusy } from '../../stores/voiceInputStore';
import { getVoiceState, type VoiceSnapshot } from '../../api/voiceInput';
import { useWorkBuddyAccounts } from '../AppManager/useWorkBuddyAccounts';

const clearModel = () => {};
const showError = (error: string) => useVoiceInputStore.setState({ error });
const Context = createContext<ReturnType<typeof useWorkBuddyAccounts> | null>(null);

export function VoiceInputProvider({ children }: { children: ReactNode }) {
  const active = useNavigationStore((state) => state.activePage === 'voice');
  const installed = useToolsStore((state) =>
    state.detectedTools.some((tool) => tool.id === 'workbuddy' && tool.installed)
  );
  const accounts = useWorkBuddyAccounts(
    installed ? 'workbuddy' : null,
    false,
    clearModel,
    showError,
    active && installed
  );
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    listen<VoiceSnapshot>('voice-input-state', (event) =>
      useVoiceInputStore.getState().accept(event.payload)
    )
      .then((stop) => {
        if (disposed) stop();
        else {
          unlisten = stop;
          void getVoiceState()
            .then((snapshot) => {
              if (!disposed) useVoiceInputStore.getState().accept(snapshot);
            })
            .catch(() => {});
        }
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
  useEffect(() => {
    if (!active) return;
    void useVoiceInputStore.getState().load();
    return () => {
      const state = useVoiceInputStore.getState();
      if (
        ['page', 'test'].includes(state.snapshot?.origin ?? '') &&
        voiceBusy(state.snapshot?.phase)
      )
        void state.cancel();
    };
  }, [active]);
  return <Context.Provider value={accounts}>{children}</Context.Provider>;
}

export function useVoiceAccounts() {
  const value = useContext(Context);
  if (!value) throw new Error('VoiceInputProvider is required');
  return value;
}
