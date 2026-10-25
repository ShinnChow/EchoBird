import { beforeEach, expect, it, vi } from 'vitest';
import * as api from '../../api/models';
import * as voiceApi from '../../api/voiceInput';
import { useVoiceInputStore as voice } from '../../stores/voiceInputStore';
import { voiceSnapshot } from './testFixtures';
import { saveVoiceSource } from './sources';
import type { NewModelForm } from '../ModelNexus/context';

vi.mock('../../api/models', () => ({ addModel: vi.fn(), deleteModel: vi.fn() }));
vi.mock('../../api/voiceInput', () => ({ saveVoiceConfig: vi.fn() }));
const form: NewModelForm = {
  name: 'MiMo ASR',
  baseUrl: 'https://api.xiaomimimo.com/v1',
  anthropicUrl: '',
  apiKey: 'fixture-key',
  modelId: 'mimo-v2.5-asr',
  voiceOptions: { protocol: 'mimo' },
};
const saved = {
  internalId: 'voice-model',
  name: form.name,
  baseUrl: form.baseUrl,
  apiKey: 'encrypted-fixture',
  modelId: form.modelId,
  scope: 'voiceInput' as const,
};
beforeEach(() => {
  vi.resetAllMocks();
  voice.setState({ ...voice.getInitialState(), snapshot: voiceSnapshot() });
  vi.mocked(api.addModel).mockResolvedValue(saved);
  vi.mocked(api.deleteModel).mockResolvedValue(true);
  vi.mocked(voiceApi.saveVoiceConfig).mockImplementation(async (config) =>
    voiceSnapshot({ config, revision: 2 })
  );
});
it('saves a voice-scoped model with its matching protocol and automatically enables voice input', async () => {
  await saveVoiceSource(form);
  expect(api.addModel).toHaveBeenCalledExactlyOnceWith({
    name: form.name,
    baseUrl: form.baseUrl,
    apiKey: form.apiKey,
    modelId: form.modelId,
    scope: 'voiceInput',
  });
  expect(voice.getState().models).toEqual([saved]);
  expect(voice.getState().snapshot?.config).toMatchObject({
    channels: [{ kind: 'model', id: saved.internalId }],
    apiOptions: { [saved.internalId]: { protocol: 'mimo' } },
    shortcutEnabled: true,
  });
  expect(api.deleteModel).not.toHaveBeenCalled();
});
it('uses the saved account speech ID and only writes a channel, without creating an API or chat model', async () => {
  const accountId = 'a'.repeat(64);
  await saveVoiceSource({
    ...form,
    accountSource: { provider: 'workBuddy', accountId },
    modelId: `workbuddy:${accountId}`,
  });
  expect(api.addModel).not.toHaveBeenCalled();
  expect(voice.getState().snapshot?.config.channels).toEqual([
    { kind: 'workbuddy', id: accountId },
  ]);
  await saveVoiceSource({
    ...form,
    accountSource: { provider: 'workBuddy', accountId },
    modelId: `workbuddy:${accountId}`,
  });
  expect(voiceApi.saveVoiceConfig).toHaveBeenCalledTimes(1);
});
it('rolls back a new API model when attaching the channel fails and preserves previous state', async () => {
  vi.mocked(voiceApi.saveVoiceConfig).mockRejectedValue('voice.error.save');
  await expect(saveVoiceSource(form)).rejects.toThrow('voice.error.save');
  expect(api.deleteModel).toHaveBeenCalledExactlyOnceWith(saved.internalId);
  expect(voice.getState().snapshot?.config.channels).toEqual([]);
  expect(voice.getState().models).toEqual([]);
});

it('rolls back a late model creation after the configuration dialog has been closed', async () => {
  let resolve!: (model: typeof saved) => void;
  vi.mocked(api.addModel).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    })
  );
  let current = true;
  const pending = saveVoiceSource(form, () => current);
  current = false;
  resolve(saved);
  await pending;
  expect(api.deleteModel).toHaveBeenCalledExactlyOnceWith(saved.internalId);
  expect(voiceApi.saveVoiceConfig).not.toHaveBeenCalled();
  expect(voice.getState().models).toEqual([]);
});
it.each(['recording', 'testing', 'transcribing'] as const)(
  'does not write or create models while %s',
  async (phase) => {
    voice.setState({ snapshot: voiceSnapshot({ phase }) });
    await expect(saveVoiceSource(form)).rejects.toThrow('voice.error.busy');
    expect(api.addModel).not.toHaveBeenCalled();
    expect(voiceApi.saveVoiceConfig).not.toHaveBeenCalled();
  }
);
it.each(['api', 'account'] as const)(
  'rejects a fourth %s source on Save without creating or saving anything',
  async (kind) => {
    voice.setState({
      snapshot: voiceSnapshot({
        config: {
          ...voiceSnapshot().config,
          channels: [1, 2, 3].map((id) => ({ kind: 'model', id: String(id) })),
        },
      }),
    });
    await expect(
      saveVoiceSource(
        kind === 'account'
          ? {
              ...form,
              accountSource: { provider: 'workBuddy', accountId: 'a'.repeat(64) },
              modelId: `workbuddy:${'a'.repeat(64)}`,
            }
          : form
      )
    ).rejects.toThrow('voice.error.channels');
    expect(api.addModel).not.toHaveBeenCalled();
    expect(voiceApi.saveVoiceConfig).not.toHaveBeenCalled();
  }
);
it('rejects a non-speech account model without creating or saving anything', async () => {
  await expect(
    saveVoiceSource({
      ...form,
      accountSource: { provider: 'workBuddy', accountId: 'a'.repeat(64) },
      modelId: 'chat-model',
    })
  ).rejects.toThrow('voice.error.missingSource');
  expect(api.addModel).not.toHaveBeenCalled();
  expect(voiceApi.saveVoiceConfig).not.toHaveBeenCalled();
});
it.each(['', 'file:///tmp/audio', 'https://user:secret@example.com/v1'])(
  'rejects unusable speech addresses before storing credentials: %s',
  async (baseUrl) => {
    await expect(saveVoiceSource({ ...form, baseUrl })).rejects.toThrow('voice.error.speechApi');
    expect(api.addModel).not.toHaveBeenCalled();
    expect(voiceApi.saveVoiceConfig).not.toHaveBeenCalled();
  }
);
