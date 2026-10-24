import { useLayoutEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceInputProvider, useVoiceAccounts } from './provider';
import { voiceSnapshot } from './testFixtures';
import { useVoiceInputStore as voice } from '../../stores/voiceInputStore';
import { useNavigationStore as navigation } from '../../stores/navigationStore';
import { useToolsStore as tools } from '../../stores/toolsStore';
import * as accountApi from '../../api/tauri';
import * as voiceApi from '../../api/voiceInput';
import { listen } from '@tauri-apps/api/event';

vi.mock('../../hooks/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('../../components/ConfirmDialog', () => ({
  useConfirm: () => vi.fn().mockResolvedValue(true),
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock('../../api/voiceInput', () => ({
  getVoiceState: vi.fn(),
  getVoiceDevices: vi.fn(),
  cancelVoice: vi.fn(),
  startVoice: vi.fn(),
  recordVoice: vi.fn(),
  saveVoiceConfig: vi.fn(),
}));
vi.mock('../../api/tauri', () => ({
  listWorkBuddyAccounts: vi.fn(),
  startWorkBuddyLogin: vi.fn(),
  pollWorkBuddyLogin: vi.fn(),
  cancelWorkBuddyLogin: vi.fn(),
  openExternal: vi.fn(),
  deleteWorkBuddyAccount: vi.fn(),
  refreshWorkBuddyAccountQuota: vi.fn(),
  claimWorkBuddyDailyCredits: vi.fn(),
}));

const saved = {
  id: 'a'.repeat(64),
  edition: 'workbuddy' as const,
  name: 'Saved account',
  active: false,
} as accountApi.WorkBuddyAccount;
let renderer: ReactTestRenderer;
let accounts: ReturnType<typeof useVoiceAccounts>;
function Harness() {
  const result = useVoiceAccounts();
  useLayoutEffect(() => {
    accounts = result;
  });
  return null;
}
async function mount() {
  act(() => {
    renderer = create(
      <VoiceInputProvider>
        <Harness />
      </VoiceInputProvider>
    );
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}
async function visit(page: 'voice' | 'models') {
  await act(async () => {
    navigation.setState({ activePage: page });
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.mocked(listen).mockResolvedValue(() => {});
  navigation.setState({ activePage: 'models' });
  voice.setState(voice.getInitialState());
  tools.setState({
    detectedTools: [{ id: 'workbuddy', name: 'WorkBuddy', category: 'desktop', installed: true }],
  });
  vi.mocked(accountApi.listWorkBuddyAccounts).mockResolvedValue([saved]);
  vi.mocked(accountApi.refreshWorkBuddyAccountQuota).mockResolvedValue({ ...saved, remaining: 42 });
  vi.mocked(voiceApi.getVoiceState).mockResolvedValue(voiceSnapshot());
  vi.mocked(voiceApi.getVoiceDevices).mockResolvedValue(['saved microphone']);
  vi.mocked(voiceApi.cancelVoice).mockResolvedValue(voiceSnapshot({ revision: 9 }));
});
afterEach(() => {
  act(() => renderer?.unmount());
  vi.useRealTimers();
});

describe('voice navigation boundaries', () => {
  it('loads only saved voice state for the global switch before visiting the voice page', async () => {
    await mount();
    expect(voiceApi.getVoiceState).toHaveBeenCalledExactlyOnceWith();
    expect(voice.getState().snapshot).toEqual(voiceSnapshot());
    expect(voiceApi.getVoiceDevices).not.toHaveBeenCalled();
    expect(accountApi.listWorkBuddyAccounts).not.toHaveBeenCalled();
    expect(accountApi.startWorkBuddyLogin).not.toHaveBeenCalled();
    expect(accountApi.refreshWorkBuddyAccountQuota).not.toHaveBeenCalled();
    expect(voiceApi.saveVoiceConfig).not.toHaveBeenCalled();
    expect(voiceApi.startVoice).not.toHaveBeenCalled();
    expect(voiceApi.recordVoice).not.toHaveBeenCalled();
    await visit('voice');
    expect(voiceApi.getVoiceDevices).toHaveBeenCalledExactlyOnceWith();
  });

  it('keeps an event newer than the startup read and ignores a read after unmount', async () => {
    let finish!: (snapshot: ReturnType<typeof voiceSnapshot>) => void;
    vi.mocked(voiceApi.getVoiceState).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    let incoming!: (snapshot: ReturnType<typeof voiceSnapshot>) => void;
    vi.mocked(listen).mockImplementation(async (_event, callback) => {
      incoming = (payload) => callback({ payload, event: 'voice-input-state', id: 0 });
      return () => {};
    });
    await mount();
    act(() => incoming(voiceSnapshot({ revision: 9, phase: 'recording' })));
    await act(async () => finish(voiceSnapshot({ revision: 1 })));
    expect(voice.getState().snapshot?.phase).toBe('recording');
    act(() => renderer.unmount());
    voice.setState(voice.getInitialState());
    vi.mocked(voiceApi.getVoiceState).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    await mount();
    act(() => renderer.unmount());
    await act(async () => finish(voiceSnapshot()));
    expect(voice.getState().snapshot).toBeNull();
  });

  it('preserves cached state silently when the startup read fails', async () => {
    const cached = voiceSnapshot({ revision: 3 });
    voice.setState({ snapshot: cached });
    vi.mocked(voiceApi.getVoiceState).mockRejectedValueOnce('voice.error.config');
    await mount();
    expect(voice.getState().snapshot).toEqual(cached);
    expect(voice.getState().error).toBeNull();
    expect(voiceApi.saveVoiceConfig).not.toHaveBeenCalled();
    expect(voiceApi.getVoiceDevices).not.toHaveBeenCalled();
  });

  it('reads installed saved accounts without login, quota, recording or writes; explicit refresh is a positive control', async () => {
    await mount();
    expect(accountApi.listWorkBuddyAccounts).not.toHaveBeenCalled();
    await visit('voice');
    expect(accounts.accounts).toEqual([saved]);
    expect(accountApi.listWorkBuddyAccounts).toHaveBeenCalledExactlyOnceWith('workbuddy');
    expect(accountApi.startWorkBuddyLogin).not.toHaveBeenCalled();
    expect(accountApi.refreshWorkBuddyAccountQuota).not.toHaveBeenCalled();
    expect(voiceApi.startVoice).not.toHaveBeenCalled();
    expect(voiceApi.recordVoice).not.toHaveBeenCalled();
    expect(voiceApi.saveVoiceConfig).not.toHaveBeenCalled();
    await act(async () => {
      await accounts.refresh(saved);
    });
    expect(accountApi.refreshWorkBuddyAccountQuota).toHaveBeenCalledExactlyOnceWith(
      'workbuddy',
      saved.id
    );
    expect(accounts.accounts[0].remaining).toBe(42);
  });

  it('does not load uninstalled accounts; becoming installed enables the saved-account read', async () => {
    tools.setState({ detectedTools: [] });
    await mount();
    await visit('voice');
    expect(accountApi.listWorkBuddyAccounts).not.toHaveBeenCalled();
    await act(async () => {
      tools.setState({
        detectedTools: [
          { id: 'workbuddy', name: 'WorkBuddy', category: 'desktop', installed: true },
        ],
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(accountApi.listWorkBuddyAccounts).toHaveBeenCalledTimes(1);
  });

  it('preserves cached rows without a blocking error after a passive reload fails', async () => {
    await mount();
    await visit('voice');
    await visit('models');
    vi.mocked(accountApi.listWorkBuddyAccounts).mockRejectedValue('accountError.read');
    await visit('voice');
    expect(accounts.accounts).toEqual([saved]);
    expect(voice.getState().error).toBeNull();
    expect(accountApi.refreshWorkBuddyAccountQuota).not.toHaveBeenCalled();
  });

  it.each(['shortcut', 'island'] as const)(
    'cancels a page microphone test on leaving and preserves %s recording',
    async (origin) => {
      await mount();
      await visit('voice');
      act(() => voice.setState({ snapshot: voiceSnapshot({ phase: 'testing', origin: 'test' }) }));
      await visit('models');
      expect(voiceApi.cancelVoice).toHaveBeenCalledTimes(1);
      await visit('voice');
      act(() => voice.setState({ snapshot: voiceSnapshot({ phase: 'recording', origin }) }));
      await visit('models');
      expect(voiceApi.cancelVoice).toHaveBeenCalledTimes(1);
    }
  );
});
