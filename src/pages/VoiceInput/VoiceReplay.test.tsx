import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { VoiceReplay } from './VoiceReplay';
import { getVoiceReplay } from '../../api/voiceInput';

vi.mock('../../api/voiceInput', () => ({ getVoiceReplay: vi.fn() }));
vi.mock('../../hooks/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));

class Playback {
  destination = {};
  resume = vi.fn().mockResolvedValue(undefined);
  decodeAudioData = vi.fn().mockResolvedValue({});
  node = {
    buffer: null,
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    disconnect: vi.fn(),
    onended: null as (() => void) | null,
  };
  createBufferSource = vi.fn(() => this.node);
  close = vi.fn().mockResolvedValue(undefined);
  constructor() {
    contexts.push(this);
  }
}

let contexts: Playback[];
let renderer: ReactTestRenderer;
const onError = vi.fn();
const props = { audioId: 1, disabled: false, active: true, onError };
function player(changes: Partial<typeof props> = {}) {
  const value = { ...props, ...changes };
  return <VoiceReplay key={`${value.audioId}:${value.disabled}:${value.active}`} {...value} />;
}
const control = () => renderer.root.findByType('button');
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  contexts = [];
  vi.stubGlobal('AudioContext', Playback);
  vi.mocked(getVoiceReplay).mockResolvedValue(new ArrayBuffer(48));
});
afterEach(() => {
  act(() => renderer?.unmount());
  vi.unstubAllGlobals();
});

it('fetches only on click, stops on a second click and releases playback on completion', async () => {
  act(() => {
    renderer = create(player());
  });
  expect(getVoiceReplay).not.toHaveBeenCalled();
  expect(contexts).toHaveLength(0);
  await act(async () => control().props.onClick());
  expect(getVoiceReplay).toHaveBeenCalledExactlyOnceWith(1);
  expect(contexts[0].resume).toHaveBeenCalledOnce();
  expect(contexts[0].node.start).toHaveBeenCalledOnce();
  expect(control().props['aria-pressed']).toBe(true);
  act(() => control().props.onClick());
  expect(contexts[0].node.stop).toHaveBeenCalledOnce();
  expect(contexts[0].close).toHaveBeenCalledOnce();
  expect(control().props['aria-pressed']).toBe(false);
  await act(async () => control().props.onClick());
  act(() => contexts[1].node.onended!());
  expect(contexts[1].node.disconnect).toHaveBeenCalledOnce();
  expect(contexts[1].close).toHaveBeenCalledOnce();
  expect(control().props['aria-pressed']).toBe(false);
});

it.each(['recording', 'navigation', 'result', 'unmount'])(
  'stops and releases the current sound on %s',
  async (change) => {
    act(() => {
      renderer = create(player());
    });
    await act(async () => control().props.onClick());
    act(() => {
      if (change === 'unmount') renderer.unmount();
      else
        renderer.update(
          player({
            disabled: change === 'recording',
            active: change !== 'navigation',
            audioId: change === 'result' ? 2 : 1,
          })
        );
    });
    expect(contexts[0].node.stop).toHaveBeenCalledOnce();
    expect(contexts[0].close).toHaveBeenCalledOnce();
    expect(getVoiceReplay).toHaveBeenCalledTimes(1);
  }
);

it('does not start playback when the audio request returns after a new recording starts', async () => {
  const pending = deferred<ArrayBuffer>();
  vi.mocked(getVoiceReplay).mockReturnValueOnce(pending.promise);
  act(() => {
    renderer = create(player());
  });
  await act(async () => control().props.onClick());
  act(() => renderer.update(player({ disabled: true })));
  await act(async () => pending.resolve(new ArrayBuffer(48)));
  expect(contexts[0].close).toHaveBeenCalledOnce();
  expect(contexts[0].decodeAudioData).not.toHaveBeenCalled();
  expect(contexts[0].node.start).not.toHaveBeenCalled();
  expect(onError).not.toHaveBeenCalledWith(true);
});

it('blocks disabled actions and discards a decode completed after the user stops', async () => {
  act(() => {
    renderer = create(player({ disabled: true }));
  });
  await act(async () => control().props.onClick());
  expect(getVoiceReplay).not.toHaveBeenCalled();
  act(() => renderer.update(player()));
  const pending = deferred<object>();
  act(() => control().props.onClick());
  contexts[0].decodeAudioData.mockReturnValueOnce(pending.promise);
  await act(async () => {});
  expect(control().props['aria-busy']).toBe(true);
  act(() => control().props.onClick());
  await act(async () => pending.resolve({}));
  expect(contexts[0].node.start).not.toHaveBeenCalled();
  expect(contexts[0].close).toHaveBeenCalledOnce();
  expect(onError).not.toHaveBeenCalledWith(true);
});

it.each(['request', 'decode'])(
  'reports %s failures without keeping a player alive',
  async (failure) => {
    if (failure === 'request') vi.mocked(getVoiceReplay).mockRejectedValueOnce('unavailable');
    act(() => {
      renderer = create(player());
    });
    act(() => control().props.onClick());
    if (failure === 'decode') contexts[0].decodeAudioData.mockRejectedValueOnce('invalid WAV');
    await act(async () => {});
    expect(contexts[0].close).toHaveBeenCalledOnce();
    expect(contexts[0].node.start).not.toHaveBeenCalled();
    expect(onError).toHaveBeenLastCalledWith(true);
    expect(control().props['aria-pressed']).toBe(false);
  }
);
