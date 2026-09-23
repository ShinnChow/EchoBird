import { ModelSwitchDivider } from './ModelSwitchDivider';
import React from 'react';
import { LoaderCircle, RefreshCw, Trash2 } from 'lucide-react';
import { useI18n } from '../../hooks/useI18n';
import { useAppManager } from './context';
import { QuotaCountdown } from './QuotaCountdown';

export const WorkBuddyAccountSection: React.FC<{ showDivider?: boolean }> = ({
  showDivider = true,
}) => {
  const { t } = useI18n();
  const { workBuddyAccounts, selectedTool } = useAppManager();
  const { accounts, selectedId, select, busy, remainingSeconds, refreshing, add, refresh, remove } =
    workBuddyAccounts;

  return (
    <section className={showDivider ? 'mb-3' : undefined}>
      <button
        type="button"
        onClick={() => void add()}
        disabled={busy}
        className="account-pill workbuddy-account-pill mb-2 flex h-12 w-full items-center justify-center rounded-full px-3 text-[17px] font-bold leading-6 transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        <span className="flex translate-y-px items-center gap-2.5">
          <img src={`/icons/tools/${selectedTool}.png`} alt="" className="h-6 w-6" />
          <span>
            {busy
              ? t('agent.waitingForBrowser').replace('{seconds}', String(remainingSeconds))
              : t('agent.addCurrentAccount')}
          </span>
        </span>
      </button>
      {accounts.length > 0 && (
        <div className="space-y-2">
          {accounts.map((account) => {
            const selected = selectedId === account.id;
            const isRefreshing = refreshing.has(account.id);
            return (
              <div
                key={account.id}
                role="radio"
                aria-checked={selected}
                tabIndex={0}
                onClick={() => select(account.id)}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    select(account.id);
                  }
                }}
                className="account-pill workbuddy-account-pill grid h-12 grid-cols-[16px_minmax(0,1fr)_44px] items-center gap-2 rounded-full border border-transparent px-3 transition-opacity hover:opacity-90"
              >
                <span
                  className="flex h-[16px] w-[16px] flex-shrink-0 items-center justify-center rounded-full border-2 border-cyber-bg"
                  aria-hidden="true"
                >
                  {selected && <span className="h-[8px] w-[8px] rounded-full bg-cyber-bg" />}
                </span>
                <span className="grid min-w-0 auto-rows-[16px] items-center">
                  <span className="block truncate text-[13px] font-semibold leading-[16px] text-cyber-text">
                    {account.name}
                  </span>
                  <span className="flex h-[16px] items-center justify-between">
                    <span className="h-1.5 min-w-0 max-w-[80px] flex-1 overflow-hidden rounded-full bg-cyber-border">
                      <span
                        className="block h-full rounded-full bg-cyber-bg"
                        style={{
                          width: `${account.total && account.remaining != null ? Math.min(100, Math.max(0, (account.remaining / account.total) * 100)) : 0}%`,
                        }}
                      />
                    </span>
                    <span className="min-w-[30px] flex-shrink-0 text-right text-[12px] font-semibold leading-[16px] text-cyber-text">
                      {account.remaining == null
                        ? '—'
                        : account.remaining.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </span>
                    <QuotaCountdown resetAt={account.expiresAt} />
                  </span>
                </span>
                <span className="grid auto-rows-[16px] items-center justify-items-center">
                  <span className="whitespace-nowrap text-[12px] font-semibold leading-[16px] text-cyber-text">
                    {account.plan || '—'}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <WorkBuddyAccountIconButton
                      ariaLabel={`${t('agent.refreshAccount')} ${account.name}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        void refresh(account);
                      }}
                    >
                      {isRefreshing ? (
                        <LoaderCircle size={12} className="animate-spin" aria-hidden="true" />
                      ) : (
                        <RefreshCw size={12} aria-hidden="true" />
                      )}
                    </WorkBuddyAccountIconButton>
                    <WorkBuddyAccountIconButton
                      ariaLabel={`${t('btn.delete')} ${account.name}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        void remove(account);
                      }}
                    >
                      <Trash2 size={11} aria-hidden="true" />
                    </WorkBuddyAccountIconButton>
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      )}
      {showDivider && <ModelSwitchDivider />}
    </section>
  );
};

interface WorkBuddyAccountIconButtonProps {
  ariaLabel: string;
  disabled?: boolean;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  children: React.ReactNode;
}

const WorkBuddyAccountIconButton: React.FC<WorkBuddyAccountIconButtonProps> = ({
  ariaLabel,
  disabled,
  onClick,
  children,
}) => {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      className="account-icon-button flex h-5 w-5 items-center justify-center rounded-full transition-colors disabled:opacity-40"
    >
      {children}
    </button>
  );
};
