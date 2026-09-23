import { useI18n } from '../../hooks/useI18n';

export function ModelSwitchDivider() {
  const { t } = useI18n();

  return (
    <div className="mt-3 px-1 flex items-center gap-2">
      <span className="flex-1 h-px bg-cyber-border/60" aria-hidden="true" />
      <span className="text-[11px] font-semibold uppercase tracking-wider text-cyber-text-secondary whitespace-nowrap">
        {t('agent.modelSwitch')}
      </span>
      <span className="flex-1 h-px bg-cyber-border/60" aria-hidden="true" />
    </div>
  );
}
