import { expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { getVoiceReplay, askSelection } from './voiceInput';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

it('asks through native capture without a model or caller-supplied text', async () => {
  await askSelection();
  expect(invoke).toHaveBeenLastCalledWith('voice_selection_ask');
});

it.each([new Uint8Array([82, 73, 70, 70]).buffer, [82, 73, 70, 70]])(
  'normalizes binary and platform IPC fallback audio responses',
  async (data) => {
    vi.mocked(invoke).mockResolvedValueOnce(data);
    const audio = await getVoiceReplay(42);
    expect(invoke).toHaveBeenLastCalledWith('voice_input_replay', { audioId: 42 });
    expect(audio).toBeInstanceOf(ArrayBuffer);
    expect(Array.from(new Uint8Array(audio))).toEqual([82, 73, 70, 70]);
  }
);
