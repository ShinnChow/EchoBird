import React from 'react';
import { useAppManager } from './context';
import { AccountSectionButton, AccountSectionRow } from './AccountSectionPrimitives';
import { useI18n } from '../../hooks/useI18n';

export const ManusAccountSection: React.FC<{ tool?: 'manus' | 'cue' }> = ({ tool = 'manus' }) => {
  const { manusAccounts, cueAccounts, isLaunching } = useAppManager();
  const accounts = tool === 'cue' ? cueAccounts : manusAccounts;
  const { t } = useI18n();
  return (
    <section>
      <AccountSectionButton
        iconSrc={`/icons/tools/${tool}.png`}
        busy={accounts.busy}
        disabled={isLaunching}
        remainingSeconds={accounts.remainingSeconds}
        waitingLabel={
          tool === 'cue' && accounts.busy
            ? t(accounts.awaitingClientExit ? 'agent.cueExitClient' : 'agent.cueLoginClient')
            : accounts.awaitingClientExit
              ? t('agent.manusExitClient')
              : undefined
        }
        onClick={() => void accounts.add()}
      />
      {accounts.accounts.length > 0 && (
        <div className="space-y-2">
          {accounts.accounts.map((account) => {
            const credits = 'credits' in account ? account.credits : null;
            return (
              <AccountSectionRow
                key={account.id}
                selected={accounts.selectedId === account.id}
                email={account.email}
                plan={account.plan}
                secondary={credits ? `${credits.total} ${t('agent.credits')}` : undefined}
                refreshing={accounts.refreshing.has(account.id)}
                authorizationFailed={accounts.authorizationFailedIds.has(account.id)}
                onSelect={() => accounts.select(account.id)}
                onRefresh={() => void accounts.refresh(account)}
                onDelete={() => void accounts.remove(account)}
              />
            );
          })}
        </div>
      )}
    </section>
  );
};
