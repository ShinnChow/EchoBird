import * as api from '../../api/models';
import { speechSourceFromSelector } from '../../api/accountProxy';
import { useVoiceInputStore, voiceBusy } from '../../stores/voiceInputStore';
import type { NewModelForm } from '../ModelNexus/context';

export async function saveVoiceSource(form: NewModelForm, isCurrent = () => true): Promise<void> {
  if (!isCurrent()) return;
  const state = useVoiceInputStore.getState();
  const config = state.snapshot?.config;
  if (!config || state.pending || state.saving || voiceBusy(state.snapshot?.phase))
    throw new Error('voice.error.busy');
  if (form.accountSource) {
    const { provider, accountId } = form.accountSource;
    const source = speechSourceFromSelector(form.modelId);
    if (!source || source.provider !== provider || source.accountId !== accountId)
      throw new Error('voice.error.missingSource');
    const kind = provider === 'workBuddy' ? 'workbuddy' : 'account';
    const id = provider === 'workBuddy' ? accountId : form.modelId;
    if (config.channels.some((channel) => channel.kind === kind && channel.id === id)) return;
    if (config.channels.length >= 3) throw new Error('voice.error.channels');
    if (!(await state.save({ channels: [...config.channels, { kind, id }] })))
      throw new Error('voice.error.save');
    return;
  }
  if (config.channels.length >= 3) throw new Error('voice.error.channels');
  if (!form.name.trim() || !form.modelId.trim()) throw new Error('voice.error.missingSource');
  try {
    const url = new URL(form.baseUrl.trim());
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password
    )
      throw new Error();
  } catch {
    throw new Error('voice.error.speechApi');
  }
  const model = await api.addModel({
    name: form.name.trim(),
    baseUrl: form.baseUrl.trim(),
    apiKey: form.apiKey,
    modelId: form.modelId.trim(),
    scope: 'voiceInput',
  });
  try {
    if (!isCurrent()) {
      await api.deleteModel(model.internalId);
      return;
    }
    const latest = useVoiceInputStore.getState();
    const current = latest.snapshot?.config;
    if (!current || current.channels.length >= 3) throw new Error('voice.error.channels');
    if (
      !(await latest.save({
        channels: [...current.channels, { kind: 'model', id: model.internalId }],
        apiOptions: {
          ...current.apiOptions,
          [model.internalId]: form.voiceOptions ?? { protocol: 'openai' },
        },
      }))
    )
      throw new Error('voice.error.save');
    useVoiceInputStore.setState((previous) => ({
      models: [...previous.models.filter((row) => row.internalId !== model.internalId), model],
    }));
  } catch (error) {
    await api.deleteModel(model.internalId);
    throw error;
  }
}
