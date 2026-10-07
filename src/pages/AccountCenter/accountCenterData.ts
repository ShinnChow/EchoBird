import type { AppManagerContextType } from '../AppManager/context';
import type { ManagedAccount } from '../AppManager/useManagedAccounts';
import type { AntigravityQuota, WorkBuddyAccount } from '../../api/tauri';
import type { TKey } from '../../i18n';
import { codexPlanLabel } from '../AppManager/codexPlanLabel';

export interface AccountMetric {
  label: string;
  value: string;
  percent?: number | null;
  resetAt?: number | null;
  showProgress?: boolean;
}

export interface AccountCardData {
  id: string;
  identity: string;
  detail?: string;
  plan?: string | null;
  subscriptionEndAt?: number | null;
  metrics: AccountMetric[];
  refreshing: boolean;
  authorizationFailed: boolean;
  refresh: (onError?: (error: unknown) => void) => Promise<void>;
  claim?: () => Promise<void>;
  dailyClaimedAt?: number | null;
  remove: () => void;
}

export interface AccountProvider {
  id: string;
  name: string;
  icon: string;
  website?: string;
  installed: boolean;
  busy: boolean;
  loading: boolean;
  remainingSeconds: number;
  add: () => void;
  accounts: AccountCardData[];
}

interface AccountGroup<A> {
  accounts: A[];
  busy: boolean;
  loading: boolean;
  remainingSeconds: number;
  refreshing: Set<string>;
  authorizationFailedIds: Set<string>;
  add: () => Promise<void>;
  refresh: (
    account: A,
    operation?: (account: A) => Promise<A>,
    onError?: (error: unknown) => void
  ) => Promise<void>;
  remove: (account: A) => Promise<void>;
}

export function accountCenterProviders(
  context: AppManagerContextType,
  t: (key: TKey) => string,
  locale: string
): AccountProvider[] {
  const quota = (
    percent?: number | null,
    resetAt?: number | null,
    label = t('accountCenter.quota')
  ): AccountMetric => ({
    label,
    value: percent == null ? '—' : `${Math.round(percent)}%`,
    percent,
    resetAt,
    showProgress: true,
  });
  const number = (value?: number | null) =>
    value == null ? '—' : new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
  const windowLabel = (index: number) =>
    t('accountCenter.window').replace('{n}', String(index + 1));
  const minimum = (quotas: AntigravityQuota[], prefix: string) =>
    quotas
      .filter((q) => q.name.startsWith(prefix))
      .reduce<
        AntigravityQuota | undefined
      >((lowest, q) => (!lowest || q.remainingPercent < lowest.remainingPercent ? q : lowest), undefined);
  const workBuddyMetrics = (account: WorkBuddyAccount): AccountMetric[] => {
    const metrics: AccountMetric[] = [];
    const credits = (
      label: string,
      remaining?: number | null,
      total?: number | null,
      resetAt?: number | null
    ) => ({
      label,
      value: number(remaining),
      resetAt,
      percent:
        remaining != null && total != null && total > 0 ? (remaining / total) * 100 : undefined,
    });
    if (account.baseRemaining != null)
      metrics.push(
        credits(
          t('agent.baseCredits'),
          account.baseRemaining,
          account.baseTotal,
          account.baseResetAt
        )
      );
    if (account.rewardRemaining != null)
      metrics.push(credits(t('agent.rewardCredits'), account.rewardRemaining, account.rewardTotal));
    if (account.addonRemaining != null)
      metrics.push(credits(t('agent.purchasedCredits'), account.addonRemaining));
    return metrics.length
      ? metrics
      : [credits(t('agent.credits'), account.remaining, account.total, account.expiresAt)];
  };
  const provider = <A extends ManagedAccount>(
    id: string,
    name: string,
    icon: string,
    toolIds: string[],
    group: AccountGroup<A>,
    describe: (
      account: A
    ) => Pick<
      AccountCardData,
      'identity' | 'detail' | 'plan' | 'metrics' | 'subscriptionEndAt' | 'claim' | 'dailyClaimedAt'
    >
  ): AccountProvider => ({
    id,
    name,
    icon,
    website: context.detectedTools.find((tool) => toolIds.includes(tool.id) && tool.website)
      ?.website,
    installed: context.detectedTools.some((tool) => toolIds.includes(tool.id) && tool.installed),
    busy: group.busy,
    loading: group.loading,
    remainingSeconds: group.remainingSeconds,
    add: () => void group.add(),
    accounts: group.accounts.map((account) => ({
      id: account.id,
      ...describe(account),
      refreshing: group.refreshing.has(account.id),
      authorizationFailed: group.authorizationFailedIds.has(account.id),
      refresh: (onError) => group.refresh(account, undefined, onError),
      remove: () => void group.remove(account),
    })),
  });
  return [
    provider(
      'codex',
      'ChatGPT / Codex',
      '/icons/tools/codex.svg',
      ['chatgptdesktop', 'codex'],
      {
        accounts: context.codexAccounts,
        busy: context.isAddingCodexAccount,
        loading: context.isLoadingCodexAccounts,
        remainingSeconds: context.codexOAuthRemainingSeconds,
        refreshing: context.refreshingCodexAccountIds,
        authorizationFailedIds: context.codexAuthorizationFailedIds,
        add: context.addCodexAccount,
        refresh: context.refreshCodexAccountQuota,
        remove: context.deleteCodexAccount,
      },
      (account) => {
        const plan = codexPlanLabel(account.plan);
        const windows = account.quotaWindows ?? [];
        const metrics =
          windows.length && windows.every((w) => w.label === '5h' || w.label === '7d')
            ? (plan === 'Plus' ? ['5h', '7d'] : ['7d']).map((label) => {
                const window = windows.find((w) => w.label === label);
                return quota(window?.remainingPercent, window?.resetAt, label);
              })
            : windows.length
              ? windows
                  .filter((w) => w.label !== '5h' || plan === 'Plus')
                  .map((w, i) => quota(w.remainingPercent, w.resetAt, w.label || windowLabel(i)))
              : [quota(account.quotaPercent, account.quotaResetAt)];
        return {
          identity: account.email,
          plan,
          subscriptionEndAt:
            account.plan?.trim().toLowerCase() === 'free'
              ? undefined
              : (account.subscriptionEndAt ?? null),
          metrics,
        };
      }
    ),
    provider(
      'claudecode',
      'Claude Code',
      '/icons/tools/claudecode.svg',
      ['claudecode'],
      context.claudeCodeAccounts,
      (account) => ({
        identity: account.email,
        plan: account.plan,
        subscriptionEndAt: null,
        metrics: [
          quota(account.fiveHour?.remainingPercent, account.fiveHour?.resetAt, '5h'),
          quota(account.sevenDay?.remainingPercent, account.sevenDay?.resetAt, '7d'),
        ],
      })
    ),
    provider(
      'dsh',
      'DeepSeek Harness',
      '/icons/tools/dsh.png',
      ['dsh'],
      context.deepSeekAccounts,
      (account) => ({
        identity: account.name,
        metrics: account.balances?.length
          ? account.balances.map((balance) => ({
              label: t('model.balance'),
              value: new Intl.NumberFormat(locale, {
                style: 'currency',
                currency: balance.currency,
                maximumFractionDigits: 2,
              }).format(balance.amount),
            }))
          : [{ label: t('model.balance'), value: account.balances == null ? '—' : '0' }],
      })
    ),
    ...(['workbuddy', 'workbuddyai'] as const).map((edition) =>
      provider(
        edition,
        edition === 'workbuddy' ? 'WorkBuddy' : 'WorkBuddy AI',
        `/icons/tools/${edition}.png`,
        [edition],
        context.workBuddyAccountGroups[edition],
        (account) => ({
          identity: account.name,
          plan: account.plan,
          metrics: workBuddyMetrics(account),
          ...(edition === 'workbuddy'
            ? {
                claim: () => context.workBuddyAccountGroups.workbuddy.claimDaily(account),
                dailyClaimedAt: account.dailyClaimedAt,
              }
            : {}),
        })
      )
    ),
    provider(
      'antigravity',
      'Antigravity',
      '/icons/tools/antigravitydesktop.png',
      ['antigravitydesktop', 'antigravity'],
      context.antigravityAccounts,
      (account) => ({
        identity: account.email,
        plan: account.plan,
        metrics: ['gemini', 'claude'].map((family) => {
          const q = minimum(account.quotas, family);
          return quota(q?.remainingPercent, q?.resetAt, family === 'gemini' ? 'Gemini' : 'Claude');
        }),
      })
    ),
    provider(
      'cursor',
      'Cursor',
      '/icons/tools/cursor.svg',
      ['cursor'],
      context.cursorAccounts,
      (account) => ({
        identity: account.email,
        plan: account.usage?.plan,
        metrics: [quota(account.usage?.remainingPercent, account.usage?.resetAt)],
      })
    ),
    {
      ...provider(
        'zcode',
        'ZCode',
        '/icons/tools/zcode.png',
        ['zcode'],
        context.zcodeAccounts,
        (account) => ({
          identity: account.email,
          detail: account.provider === 'bigmodel' ? 'BigModel' : 'Z.ai',
          plan:
            account.plan === 'Trial'
              ? t('agent.zcodeTrial')
              : account.plan?.replace(/^ZCode\s+/i, ''),
          subscriptionEndAt:
            ['trial', 'free'].includes(account.plan?.toLowerCase() ?? '') ||
            (!account.plan && account.subscriptionEndAt == null)
              ? undefined
              : (account.subscriptionEndAt ?? null),
          metrics: account.quotaWindows?.length
            ? account.quotaWindows.map((w, i) =>
                quota(w.remainingPercent, w.resetAt, windowLabel(i))
              )
            : [quota(account.remainingPercent, account.resetAt)],
        })
      ),
      website:
        context.zcodeAccounts.provider === 'bigmodel'
          ? 'https://bigmodel.cn/glm-coding'
          : 'https://z.ai/subscribe',
    },
    provider(
      'grok',
      'Grok Build',
      '/icons/tools/grok.svg',
      ['grok'],
      context.grokAccounts,
      (account) => ({ identity: account.email, plan: account.plan, metrics: [quota()] })
    ),
    provider(
      'grokbot',
      'Grok Bot',
      '/icons/tools/grokbot.png',
      ['grokbot'],
      context.grokBotAccounts,
      (account) => ({
        identity: account.email,
        plan:
          account.usage?.plan?.trim().toLowerCase() === 'grok bot plan'
            ? null
            : account.usage?.plan,
        metrics: [quota(account.usage?.remainingPercent, account.usage?.resetAt)],
      })
    ),
    provider(
      'manus',
      'Manus',
      '/icons/tools/manus.png',
      ['manus'],
      context.manusAccounts,
      (account) => ({
        identity: account.email,
        plan: account.plan,
        metrics: [
          {
            label: t('agent.credits'),
            value: number('credits' in account ? account.credits?.total : null),
          },
        ],
      })
    ),
  ];
}
