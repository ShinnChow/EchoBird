import { useI18n } from '../../hooks/useI18n';
import type { VoiceUsage } from '../../api/voiceInput';

export function VoiceStats({ days, usage }: { days: Record<string, number>; usage: VoiceUsage }) {
  const { t, locale } = useI18n();
  const characters = Object.values(days).reduce((total, count) => total + count, 0);
  const timed = usage.characters > 0 && usage.durationMs > 0;
  const number = (value: number) =>
    value.toLocaleString(locale, {
      maximumFractionDigits: 1,
      notation: value >= 10000 ? 'compact' : 'standard',
    });
  const span = (milliseconds: number) => {
    const seconds = Math.round(milliseconds / 1000);
    if (seconds < 60) return { value: number(seconds), unit: t('voice.seconds') };
    if (seconds < 3600) return { value: number(seconds / 60), unit: t('voice.minutes') };
    return { value: number(seconds / 3600), unit: t('voice.hours') };
  };
  const metrics = [
    { label: t('voice.characters'), value: characters > 0 ? number(characters) : '—' },
    {
      label: t('voice.timeSaved'),
      ...(timed
        ? span(Math.max(0, (usage.characters / 40) * 60000 - usage.durationMs))
        : { value: '—' }),
    },
    {
      label: t('voice.speechRate'),
      value: timed ? number(Math.round((usage.characters * 60000) / usage.durationMs)) : '—',
      unit: timed ? t('voice.charactersPerMinute') : undefined,
    },
    { label: t('voice.dictationDuration'), ...(timed ? span(usage.durationMs) : { value: '—' }) },
  ];
  return (
    <>
      <dl className="voice-metrics" aria-label={t('voice.statistics')}>
        {metrics.map(({ label, value, unit }) => (
          <div key={label} className="voice-metric">
            <dt>{label}</dt>
            <dd>
              {value}
              {unit && <span>{unit}</span>}
            </dd>
          </div>
        ))}
      </dl>
      {characters > usage.characters && (
        <div className="voice-statistics-note">
          <span>{t('voice.partialTiming')}</span>
        </div>
      )}
    </>
  );
}
