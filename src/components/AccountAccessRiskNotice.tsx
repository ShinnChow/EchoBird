import { useId } from 'react';
import { Check } from 'lucide-react';
import { useConfirm } from './ConfirmDialog';
import { useI18n } from '../hooks/useI18n';
import { useAccountAccessRisk } from '../stores/accountAccessRiskStore';

export function AccountAccessRiskNotice() {
  const { t } = useI18n();
  const confirm = useConfirm();
  const acknowledgementId = useId();
  const { acknowledged, setAcknowledged } = useAccountAccessRisk();
  return (
    <div className="flex items-center justify-between gap-2 pb-1">
      <div className="flex-1 min-w-0 text-xs text-cyber-text-secondary select-none">
        <label htmlFor={acknowledgementId}>{t('accountProxy.riskReadPrefix')}</label>
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={() =>
            void confirm({
              title: t('accountProxy.riskTitle'),
              message: t('accountProxy.riskMessage'),
              type: 'warning',
              confirmText: t('accountProxy.riskDismiss'),
              cancelText: '',
            })
          }
          className="mx-0.5 whitespace-nowrap text-cyber-text underline underline-offset-2 decoration-cyber-text-secondary/70 hover:text-cyber-accent hover:decoration-cyber-accent transition-colors"
        >
          {t('accountProxy.riskNotice')}
        </button>
        <label htmlFor={acknowledgementId}>{t('accountProxy.riskAcceptSuffix')}</label>
      </div>
      <label className="shrink-0 flex items-center">
        <input
          id={acknowledgementId}
          type="checkbox"
          aria-label={`${t('accountProxy.riskReadPrefix')}${t('accountProxy.riskNotice')}${t('accountProxy.riskAcceptSuffix')}`}
          checked={acknowledged}
          onChange={(event) => setAcknowledged(event.target.checked)}
          className="peer sr-only"
        />
        <span
          aria-hidden="true"
          className={`w-[18px] h-[18px] shrink-0 flex items-center justify-center rounded-[5px] border shadow-sm transition-colors duration-150 peer-focus-visible:ring-2 peer-focus-visible:ring-cyber-accent/40 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-cyber-bg ${acknowledged ? 'border-cyber-accent bg-cyber-accent text-white' : 'border-cyber-text-muted/50 bg-cyber-input'}`}
        >
          {acknowledged && <Check size={12} strokeWidth={3} />}
        </span>
      </label>
    </div>
  );
}
