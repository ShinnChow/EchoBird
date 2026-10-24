import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../api/voiceInput';
import { voiceSnapshot } from '../pages/VoiceInput/testFixtures';
import { useVoiceInputStore as store } from './voiceInputStore';

vi.mock('../api/voiceInput', () => ({
  getVoiceState: vi.fn(),
  getVoiceDevices: vi.fn(),
  saveVoiceConfig: vi.fn(),
  startVoice: vi.fn(),
  recordVoice: vi.fn(),
  stopVoice: vi.fn(),
  cancelVoice: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.resetAllMocks();
  store.setState(store.getInitialState());
  vi.mocked(api.getVoiceState).mockResolvedValue(voiceSnapshot());
  vi.mocked(api.getVoiceDevices).mockResolvedValue(['microphone']);
});

describe('voice input lifecycle', () => {
  it('turns input off in the same save when its last source is removed and requires explicit re-enabling', async () => {
    const channels = [0, 1, 2].map((index) => ({ kind: 'model' as const, id: `speech-${index}` }));
    const config = { ...voiceSnapshot().config, channels, shortcutEnabled: true };
    store.setState({ snapshot: voiceSnapshot({ config }) });
    let revision = 1;
    vi.mocked(api.saveVoiceConfig).mockImplementation(async (saved) =>
      voiceSnapshot({ config: saved, revision: ++revision })
    );
    for (const remaining of [channels.slice(1), channels.slice(2), []]) {
      expect(await store.getState().save({ channels: remaining })).toBe(true);
      expect(api.saveVoiceConfig).toHaveBeenLastCalledWith({
        ...config,
        channels: remaining,
        shortcutEnabled: remaining.length > 0,
      });
      expect(store.getState().snapshot?.config.shortcutEnabled).toBe(remaining.length > 0);
    }
    expect(api.saveVoiceConfig).toHaveBeenCalledTimes(3);
    expect(await store.getState().save({ channels })).toBe(true);
    expect(store.getState().snapshot?.config.shortcutEnabled).toBe(false);
    expect(await store.getState().save({ shortcutEnabled: true })).toBe(true);
    expect(store.getState().snapshot?.config.shortcutEnabled).toBe(true);
    expect(api.recordVoice).not.toHaveBeenCalled();
    expect(api.startVoice).not.toHaveBeenCalled();
    expect(api.stopVoice).not.toHaveBeenCalled();
    expect(api.cancelVoice).not.toHaveBeenCalled();
  });

  it('preserves sources and input state when removing the last source fails', async () => {
    const config = {
      ...voiceSnapshot().config,
      channels: [{ kind: 'model' as const, id: 'speech' }],
      shortcutEnabled: true,
    };
    const snapshot = voiceSnapshot({ config });
    store.setState({ snapshot });
    vi.mocked(api.saveVoiceConfig).mockRejectedValue('voice.error.save');
    expect(await store.getState().save({ channels: [] })).toBe(false);
    expect(api.saveVoiceConfig).toHaveBeenCalledExactlyOnceWith({
      ...config,
      channels: [],
      shortcutEnabled: false,
    });
    expect(store.getState().snapshot).toBe(snapshot);
    expect(store.getState().error).toBe('voice.error.save');
  });

  it('passive loading only reads settings and device names', async () => {
    await store.getState().load();
    expect(store.getState().devices).toEqual(['microphone']);
    expect(api.startVoice).not.toHaveBeenCalled();
    expect(api.recordVoice).not.toHaveBeenCalled();
    expect(api.saveVoiceConfig).not.toHaveBeenCalled();
    expect(api.stopVoice).not.toHaveBeenCalled();
    expect(api.cancelVoice).not.toHaveBeenCalled();
  });

  it('preserves cached settings and rows when passive reads fail', async () => {
    const snapshot = voiceSnapshot({ text: 'cached result' });
    store.setState({ snapshot, devices: ['cached microphone'] });
    vi.mocked(api.getVoiceState).mockRejectedValue(new Error('read failed'));
    vi.mocked(api.getVoiceDevices).mockRejectedValue(new Error('device failed'));
    await store.getState().load();
    expect(store.getState().snapshot).toBe(snapshot);
    expect(store.getState().devices).toEqual(['cached microphone']);
    expect(store.getState().error).toBeNull();
  });

  it('does not overwrite an incoming recording state with a stale read', async () => {
    const pending = deferred<ReturnType<typeof voiceSnapshot>>();
    vi.mocked(api.getVoiceState).mockReturnValue(pending.promise);
    const loading = store.getState().load();
    store.getState().accept(voiceSnapshot({ revision: 5, phase: 'recording' }));
    pending.resolve(voiceSnapshot({ revision: 2 }));
    await loading;
    expect(store.getState().snapshot?.phase).toBe('recording');
  });

  it('retains the previous shortcut when registration or saving fails', async () => {
    store.setState({ snapshot: voiceSnapshot() });
    vi.mocked(api.saveVoiceConfig).mockRejectedValue('voice.error.shortcut');
    expect(
      await store.getState().save({ shortcut: { code: 'KeyK', modifiers: ['Control'] } })
    ).toBe(false);
    expect(store.getState().snapshot?.config.shortcut.code).toBe('AltRight');
    expect(store.getState().error).toBe('voice.error.shortcut');
    expect(store.getState().saving).toBe(false);
  });

  it('prevents repeated starts and ignores a start result arriving after cancellation', async () => {
    store.setState({ snapshot: voiceSnapshot() });
    const pending = deferred<ReturnType<typeof voiceSnapshot>>();
    vi.mocked(api.startVoice).mockReturnValue(pending.promise);
    vi.mocked(api.cancelVoice).mockResolvedValue(voiceSnapshot({ revision: 4 }));
    const starting = store.getState().start();
    await store.getState().start();
    expect(api.startVoice).toHaveBeenCalledTimes(1);
    expect(api.startVoice).toHaveBeenCalledWith();
    await store.getState().cancel();
    pending.resolve(voiceSnapshot({ revision: 2, phase: 'testing' }));
    await starting;
    expect(store.getState().snapshot?.phase).toBe('idle');
  });

  it('ignores a late transcription after cancellation and does not submit a second stop', async () => {
    store.setState({ snapshot: voiceSnapshot({ phase: 'recording' }) });
    const pending = deferred<ReturnType<typeof voiceSnapshot>>();
    vi.mocked(api.stopVoice).mockReturnValue(pending.promise);
    vi.mocked(api.cancelVoice).mockResolvedValue(voiceSnapshot({ revision: 8 }));
    const stopping = store.getState().stop();
    await store.getState().stop();
    await store.getState().cancel();
    pending.resolve(
      voiceSnapshot({
        revision: 7,
        phase: 'done',
        text: 'late text',
        days: { today: 8 },
        usage: { characters: 8, durationMs: 5000 },
      })
    );
    await stopping;
    expect(api.stopVoice).toHaveBeenCalledTimes(1);
    expect(store.getState().snapshot?.text).toBe('');
    expect(store.getState().snapshot?.days).toEqual({});
    expect(store.getState().snapshot?.usage).toEqual({ characters: 0, durationMs: 0 });
  });

  it('blocks settings writes and new recording while transcription is pending', async () => {
    store.setState({ snapshot: voiceSnapshot({ phase: 'transcribing' }) });
    expect(await store.getState().save({ channels: [] })).toBe(false);
    await store.getState().start();
    await store.getState().record();
    expect(api.saveVoiceConfig).not.toHaveBeenCalled();
    expect(api.startVoice).not.toHaveBeenCalled();
    expect(api.recordVoice).not.toHaveBeenCalled();
  });

  it('does not duplicate a mouse start or apply its late response after cancellation', async () => {
    const config = { ...voiceSnapshot().config, shortcutEnabled: true };
    store.setState({ snapshot: voiceSnapshot({ config }) });
    const pending = deferred<ReturnType<typeof voiceSnapshot>>();
    vi.mocked(api.recordVoice).mockReturnValue(pending.promise);
    vi.mocked(api.cancelVoice).mockResolvedValue(voiceSnapshot({ config, revision: 4 }));
    const recording = store.getState().record();
    await store.getState().record();
    expect(api.recordVoice).toHaveBeenCalledExactlyOnceWith();
    await store.getState().cancel();
    pending.resolve(voiceSnapshot({ config, revision: 2, phase: 'recording', origin: 'island' }));
    await recording;
    expect(store.getState().snapshot?.phase).toBe('idle');
  });
});
