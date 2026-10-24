import { useEffect, useState } from 'react';
import { accountProxyProviders, listProxyAccounts } from '../../api/accountProxy';
import type { AccountProvider } from '../../api/types';
import { AccountAccessRiskNotice } from '../../components/AccountAccessRiskNotice';
import { useAccountAccessRisk } from '../../stores/accountAccessRiskStore';
import { useI18n } from '../../hooks/useI18n';
import { useNavigationStore } from '../../stores/navigationStore';
import { useModelNexus } from '../ModelNexus/context';

export function openAccountModelForm(
  provider: AccountProvider,
  context: ReturnType<typeof useModelNexus>,
  destination: 'freeRouter' | 'voiceInput' = 'freeRouter'
) {
  context.setNewModelForm({
    name: accountProxyProviders.find((p) => p.id === provider)?.name ?? '',
    baseUrl: '',
    anthropicUrl: '',
    apiKey: '',
    modelId: '',
    accountSource: { provider, accountId: '' },
  });
  context.setEditingModelId(null);
  context.setKeyDestroyed(false);
  context.setShowApiKey(false);
  context.setModelModalDestination(destination);
  context.setShowAddModelModal(true);
}

export function AccountProxyPanel() {
  const context = useModelNexus();
  const { t } = useI18n();
  const { acknowledged } = useAccountAccessRisk();
  const activePage = useNavigationStore((state) => state.activePage);
  const [accountCounts, setAccountCounts] = useState<Partial<Record<AccountProvider, number>>>({});

  useEffect(() => {
    if (activePage !== 'freeModels') return;
    let ignore = false;
    void Promise.resolve().then(async () => {
      if (ignore) return;
      const results = await Promise.allSettled(
        accountProxyProviders.map((provider) => listProxyAccounts(provider.id))
      );
      if (ignore) return;
      setAccountCounts((previous) => {
        const counts = { ...previous };
        results.forEach((result, index) => {
          if (result.status === 'fulfilled')
            counts[accountProxyProviders[index].id] = result.value.length;
        });
        return counts;
      });
    });
    return () => {
      ignore = true;
    };
  }, [activePage]);

  const sortedProviders = [...accountProxyProviders].sort(
    (a, b) => (accountCounts[b.id] ?? 0) - (accountCounts[a.id] ?? 0)
  );

  return (
    <div className="flex-1 px-2 pt-0.5 pb-2 overflow-y-auto space-y-2">
      <AccountAccessRiskNotice />
      {sortedProviders.map((provider) => (
        <button
          key={provider.id}
          type="button"
          disabled={!acknowledged}
          onClick={() => {
            if (acknowledged) openAccountModelForm(provider.id, context);
          }}
          aria-label={`${t('freeModels.addToRouter')}: ${provider.name}`}
          className="w-full min-h-[64px] flex items-center gap-3 px-3 bg-cyber-surface/60 rounded text-left enabled:hover:bg-cyber-elevated/70 disabled:opacity-40 disabled:grayscale transition-colors"
        >
          <img
            src={`/icons/tools/${provider.icon}`}
            alt=""
            className="w-8 h-8 shrink-0 object-contain"
          />
          <span className="flex-1 min-w-0 text-base font-bold text-cyber-text truncate">
            {provider.name}
          </span>
          {['antigravity', 'claudeCode', 'qoder', 'qoderCn', 'doubaowork', 'dola'].includes(
            provider.id
          ) && (
            <span className="shrink-0 whitespace-nowrap font-medium text-cyber-accent text-[10px] leading-none">
              {t('accountProxy.highRisk')}
            </span>
          )}
          <span className="shrink-0 text-xs text-cyber-text-secondary tabular-nums whitespace-nowrap">
            {accountCounts[provider.id] === undefined
              ? '—'
              : t(
                  accountCounts[provider.id] === 1
                    ? 'accountProxy.accountCountOne'
                    : 'accountProxy.accountCountOther'
                ).replace('{count}', String(accountCounts[provider.id]))}
          </span>
        </button>
      ))}
    </div>
  );
}
