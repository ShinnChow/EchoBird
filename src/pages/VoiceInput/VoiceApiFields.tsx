import { ModelIdCombobox } from '../../components/ModelIdCombobox';
import { useI18n } from '../../hooks/useI18n';
import { voiceProtocols, type VoiceApiProtocol } from '../../api/voiceInput';
import type { NewModelForm } from '../ModelNexus/context';

export function VoiceApiFields({
  form,
  setForm,
  active,
}: {
  form: NewModelForm;
  setForm: React.Dispatch<React.SetStateAction<NewModelForm>>;
  active: boolean;
}) {
  const { t } = useI18n();
  const protocol = form.voiceOptions?.protocol ?? 'openai';
  return (
    <>
      <div>
        <label className="block text-xs text-cyber-text-secondary mb-1">
          {t('voice.serviceType')}
        </label>
        <ModelIdCombobox
          selectOnly
          inferFreeFromId={false}
          ariaLabel={t('voice.serviceType')}
          value={protocol}
          options={Object.keys(voiceProtocols)}
          optionLabels={voiceProtocols}
          disabled={!active}
          onChange={(value) =>
            setForm((current) => ({
              ...current,
              voiceOptions: { protocol: value as VoiceApiProtocol },
            }))
          }
        />
      </div>
      <div>
        <label className="block text-xs text-cyber-text-secondary mb-1">{t('model.modelId')}</label>
        <ModelIdCombobox
          ariaLabel={t('model.modelId')}
          value={form.modelId}
          options={form.modelIdOptions ?? []}
          inferFreeFromId={false}
          disabled={!active}
          onChange={(modelId) => setForm((current) => ({ ...current, modelId }))}
        />
      </div>
    </>
  );
}
