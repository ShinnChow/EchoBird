import { ModelSwitchDivider } from './ModelSwitchDivider';
import React, { useEffect, useState } from 'react';
import { LoaderCircle, RefreshCw, Trash2 } from 'lucide-react';
import { useI18n } from '../../hooks/useI18n';
import { useAppManager } from './context';

function formatQuotaCountdown(resetAt: number, now: number): string {
  const minutes = Math.max(0, Math.ceil((resetAt * 1000 - now) / 60_000));
  if (minutes >= 24 * 60) {
    const days = Math.floor(minutes / (24 * 60));
    const hours = Math.floor((minutes % (24 * 60)) / 60);
    return `${days}d${hours}h`;
  }
  if (minutes >= 60) {
    return `${Math.floor(minutes / 60)}h${minutes % 60}m`;
  }
  return `${minutes}m`;
}

const QuotaCountdown: React.FC<{ resetAt?: number | null }> = ({ resetAt }) => {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!resetAt) return;
    const initial = setTimeout(() => setNow(Date.now()), 0);
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [resetAt]);
  return (
    <span className="text-cyber-text">
      {resetAt && now ? formatQuotaCountdown(resetAt, now) : '—'}
    </span>
  );
};

export const ClaudeCodeAccountSection: React.FC<{ showDivider?: boolean }> = ({
  showDivider = true,
}) => {
  const { t } = useI18n();
  const { claudeCodeAccounts: state } = useAppManager();
  const { accounts, selectedId, select, busy, remainingSeconds, refreshing, add, refresh, remove } =
    state;

  return (
    <section className={showDivider ? 'mb-3' : undefined}>
      <button
        type="button"
        onClick={() => void add()}
        disabled={busy}
        className="account-pill claude-account-pill mb-2 flex h-12 w-full items-center justify-center rounded-full px-3 text-[17px] font-bold leading-6 transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        <span className="flex translate-y-px items-center gap-2.5">
          <img src="/icons/tools/claudecode.svg" alt="" className="h-6 w-6" />
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
            const planLabel = account.plan;
            return (
              <div
                key={account.id}
                role="radio"
                aria-checked={selected}
                tabIndex={0}
                onClick={() => select(account.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    select(account.id);
                  }
                }}
                className="account-pill claude-account-pill grid h-12 grid-cols-[16px_minmax(0,1fr)_44px] items-center gap-2 rounded-full border border-transparent px-3 transition-opacity hover:opacity-90"
              >
                <span
                  className="flex h-[16px] w-[16px] flex-shrink-0 items-center justify-center rounded-full border-2 border-cyber-bg"
                  aria-hidden="true"
                >
                  {selected && <span className="h-[8px] w-[8px] rounded-full bg-cyber-bg" />}
                </span>
                <span className="grid min-w-0 auto-rows-[16px] items-center">
                  <span className="block truncate text-[13px] font-semibold leading-[16px] text-cyber-text">
                    {account.email}
                  </span>
                  <span className="flex h-[16px] items-center gap-2 whitespace-nowrap text-[12px] leading-[16px] text-cyber-text">
                    <span>
                      5h: {account.fiveHour == null ? '—' : `${account.fiveHour.remainingPercent}%`}{' '}
                      <QuotaCountdown resetAt={account.fiveHour?.resetAt} />
                    </span>
                    <span>
                      7d: {account.sevenDay == null ? '—' : `${account.sevenDay.remainingPercent}%`}{' '}
                      <QuotaCountdown resetAt={account.sevenDay?.resetAt} />
                    </span>
                  </span>
                </span>
                <span className="grid auto-rows-[16px] items-center justify-items-center">
                  <span className="whitespace-nowrap text-[12px] font-semibold leading-[16px] text-cyber-text">
                    {planLabel || '—'}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <AccountIconButton
                      ariaLabel={`${t('agent.refreshAccount')} ${account.email}`}
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
                    </AccountIconButton>
                    <AccountIconButton
                      ariaLabel={`${t('btn.delete')} ${account.email}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        void remove(account);
                      }}
                    >
                      <Trash2 size={11} aria-hidden="true" />
                    </AccountIconButton>
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

interface AccountIconButtonProps {
  ariaLabel: string;
  disabled?: boolean;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  children: React.ReactNode;
}

const AccountIconButton: React.FC<AccountIconButtonProps> = ({
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
