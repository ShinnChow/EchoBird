import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { AppManagerContextType } from '../AppManager/context';
import { AccountCard } from './AccountCenter';
import { accountCenterProviders } from './accountCenterData';

vi.mock('../../hooks/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));

function context() {
  const group = () => ({
    accounts: [],
    busy: false,
    loading: false,
    remainingSeconds: 0,
    refreshing: new Set<string>(),
    authorizationFailedIds: new Set<string>(),
    add: vi.fn(),
    refresh: vi.fn(),
    remove: vi.fn(),
  });
  return {
    detectedTools: [],
    codexAccounts: [],
    isAddingCodexAccount: false,
    isLoadingCodexAccounts: false,
    codexOAuthRemainingSeconds: 0,
    refreshingCodexAccountIds: new Set<string>(),
    codexAuthorizationFailedIds: new Set<string>(),
    addCodexAccount: vi.fn(),
    refreshCodexAccountQuota: vi.fn(),
    deleteCodexAccount: vi.fn(),
    claudeCodeAccounts: group(),
    deepSeekAccounts: group(),
    workBuddyAccountGroups: { workbuddy: group(), workbuddyai: group() },
    antigravityAccounts: group(),
    cursorAccounts: group(),
    zcodeAccounts: group(),
    grokAccounts: group(),
    grokBotAccounts: group(),
    manusAccounts: group(),
  } as unknown as AppManagerContextType;
}

const providers = (state: AppManagerContextType) =>
  accountCenterProviders(state, (key) => key, 'en');

describe('Account Center display data', () => {
  it('shows the Manus exit instruction only during its native login capture stage', () => {
    const state = context();
    expect(providers(state).every((provider) => provider.waitingLabel === undefined)).toBe(true);
    state.manusAccounts.awaitingClientExit = true;
    state.manusAccounts.busy = true;
    state.manusAccounts.remainingSeconds = 30;
    const groups = providers(state);
    expect(groups.find((provider) => provider.id === 'manus')).toMatchObject({
      waitingLabel: 'agent.manusExitClient',
      busy: true,
      remainingSeconds: 30,
    });
    expect(
      groups
        .filter((provider) => provider.id !== 'manus')
        .every((provider) => provider.waitingLabel === undefined)
    ).toBe(true);
  });

  it('replaces failed account quotas and balances with a short status while keeping identity and actions', () => {
    const state = context();
    state.codexAccounts = [
      {
        id: 'same',
        email: 'failed@example.test',
        plan: 'Plus',
        active: false,
        quotaWindows: [
          { label: '5h', remainingPercent: 75, resetAt: 1900000000 },
          { label: '7d', remainingPercent: 80 },
        ],
      },
    ];
    state.codexAuthorizationFailedIds.add('same');
    state.deepSeekAccounts.accounts = [
      {
        id: 'same',
        name: 'Balance account',
        active: false,
        balances: [{ currency: 'CNY', amount: 12.5 }],
      },
    ];
    const groups = providers(state);
    const codex = groups[0];
    const balance = groups.find((p) => p.id === 'dsh')!;
    expect(codex.accounts[0].authorizationFailed).toBe(true);
    expect(balance.accounts[0].authorizationFailed).toBe(false);
    state.deepSeekAccounts.authorizationFailedIds.add('same');
    for (const provider of providers(state).filter((p) => ['codex', 'dsh'].includes(p.id))) {
      const account = provider.accounts[0];
      const markup = renderToStaticMarkup(<AccountCard provider={provider} account={account} />);
      expect(markup).toContain('role="status"');
      expect(markup).toContain('>accountCenter.authFailed<');
      expect(markup).toContain(account.identity);
      expect(markup).toContain(`agent.refreshAccount ${account.identity}`);
      expect(markup).toContain(`btn.delete ${account.identity}`);
      expect(markup).not.toContain('role="progressbar"');
      expect(markup).not.toContain('accountCenter.reset');
      expect(markup).not.toContain('>75%<');
      expect(markup).not.toContain('>5h<');
      expect(markup).not.toContain('12.50');
      if (account.plan) expect(markup).toContain(`>${account.plan}<`);
    }
  });

  it('shows real balances without making up percentages and preserves unknown vs zero', () => {
    const state = context();
    state.deepSeekAccounts.accounts = [
      {
        id: 'balance',
        name: 'balance',
        active: false,
        balances: [{ currency: 'USD', amount: 12.5 }],
      },
      { id: 'unknown', name: 'unknown', active: false, balances: null },
      { id: 'zero', name: 'zero', active: false, balances: [] },
    ];
    const provider = providers(state).find((p) => p.id === 'dsh')!;
    expect(provider.accounts.map((a) => a.metrics[0].value)).toEqual(['$12.50', '—', '0']);
    for (const account of provider.accounts) {
      expect(account.metrics[0].percent).toBeUndefined();
      expect(
        renderToStaticMarkup(<AccountCard provider={provider} account={account} />)
      ).not.toContain('role="progressbar"');
    }
  });

  it('keeps zero quota real and unknown quota unknown, with the plan shown once', () => {
    const state = context();
    state.codexAccounts = [
      {
        id: 'known',
        email: 'known@example.test',
        plan: 'Plus',
        active: true,
        quotaWindows: [{ label: '5h', remainingPercent: 0 }],
      },
      { id: 'unknown', email: 'unknown@example.test', active: false },
    ];
    const provider = providers(state)[0];
    const known = renderToStaticMarkup(
      <AccountCard provider={provider} account={provider.accounts[0]} />
    );
    const unknown = renderToStaticMarkup(
      <AccountCard provider={provider} account={provider.accounts[1]} />
    );
    expect(known).toContain('aria-valuenow="0"');
    expect(known).toContain('0%');
    expect(known.split('Plus')).toHaveLength(2);
    expect(unknown).toContain('—');
    expect(unknown).not.toContain('role="progressbar"');
    expect(unknown).not.toContain('0%');
  });

  it('uses separate WorkBuddy balances and only derives a percentage from a real limit', () => {
    const state = context();
    state.workBuddyAccountGroups.workbuddy.accounts = [
      {
        id: 'cn',
        name: 'CN',
        edition: 'workbuddy',
        active: false,
        plan: null,
        remaining: 50,
        total: 100,
        baseRemaining: 25,
        baseTotal: 100,
        baseResetAt: 123,
        rewardRemaining: 0,
        rewardTotal: null,
        addonRemaining: 12,
        expiresAt: null,
      },
    ];
    state.workBuddyAccountGroups.workbuddyai.accounts = [
      {
        id: 'global',
        name: 'Global',
        edition: 'workbuddyai',
        active: false,
        plan: null,
        remaining: null,
        total: null,
        expiresAt: null,
      },
    ];
    const groups = providers(state);
    const cn = groups.find((p) => p.id === 'workbuddy')!.accounts[0];
    const global = groups.find((p) => p.id === 'workbuddyai')!.accounts[0];
    expect(cn.metrics.map((m) => [m.value, m.percent])).toEqual([
      ['25', 25],
      ['0', undefined],
      ['12', undefined],
    ]);
    expect(cn.metrics[0].resetAt).toBe(123);
    expect(global.metrics[0]).toMatchObject({ value: '—', percent: undefined });
  });

  it('keeps the Antigravity minimum-family reset paired with its percentage', () => {
    const state = context();
    state.antigravityAccounts.accounts = [
      {
        id: 'a',
        email: 'a@example.test',
        active: false,
        plan: null,
        quotas: [
          { name: 'gemini-fast', remainingPercent: 90, resetAt: 10 },
          { name: 'gemini-pro', remainingPercent: 20, resetAt: 30 },
          { name: 'claude', remainingPercent: 80, resetAt: 40 },
        ],
      },
    ];
    const account = providers(state).find((p) => p.id === 'antigravity')!.accounts[0];
    expect(account.metrics).toMatchObject([
      { label: 'Gemini', percent: 20, resetAt: 30 },
      { label: 'Claude', percent: 80, resetAt: 40 },
    ]);
  });

  it('keeps both Claude windows unknown until each has its own quota data', () => {
    const state = context();
    const row = { id: 'claude', email: 'claude@example.test', plan: 'Max', active: false };
    state.claudeCodeAccounts.accounts = [row];
    const provider = providers(state).find((p) => p.id === 'claudecode')!;
    expect(provider.accounts[0].metrics).toMatchObject([
      { label: '5h', value: '—', percent: undefined, resetAt: undefined },
      { label: '7d', value: '—', percent: undefined, resetAt: undefined },
    ]);
    const markup = renderToStaticMarkup(
      <AccountCard provider={provider} account={provider.accounts[0]} />
    );
    expect(markup).toContain('>5h<');
    expect(markup).toContain('>7d<');
    expect(markup).not.toContain('role="progressbar"');
    expect(markup).not.toContain('>0%<');
    state.claudeCodeAccounts.accounts = [
      { ...row, fiveHour: { remainingPercent: 0, resetAt: 123 } },
    ];
    expect(providers(state).find((p) => p.id === 'claudecode')!.accounts[0].metrics).toMatchObject([
      { label: '5h', value: '0%', percent: 0, resetAt: 123 },
      { label: '7d', value: '—', percent: undefined, resetAt: undefined },
    ]);
  });

  it('keeps Plus short/weekly quotas and subscription expiry as three independent deadlines', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-07T04:00:00Z'));
    const now = Date.now() / 1000;
    const state = context();
    state.codexAccounts = [
      {
        id: 'plus',
        email: 'plus@example.test',
        plan: 'Plus',
        active: true,
        subscriptionEndAt: now + 30 * 86400,
        quotaWindows: [
          { label: '7d', remainingPercent: 40, resetAt: now + 4 * 86400 },
          { label: '5h', remainingPercent: 75, resetAt: now + 3 * 3600 },
        ],
      },
    ];
    const provider = providers(state)[0];
    const account = provider.accounts[0];
    expect(account.metrics).toMatchObject([
      { label: '5h', percent: 75, resetAt: now + 3 * 3600 },
      { label: '7d', percent: 40, resetAt: now + 4 * 86400 },
    ]);
    expect(account.subscriptionEndAt).toBe(now + 30 * 86400);
    let renderer: ReactTestRenderer | undefined;
    try {
      act(() => {
        renderer = create(<AccountCard provider={provider} account={account} />);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(renderer!.root.findAllByProps({ role: 'progressbar' })).toHaveLength(2);
      const times = renderer!.root.findAllByType('span').filter((node) => node.props['aria-label']);
      expect(times.map((node) => node.props['aria-label']).sort()).toEqual([
        'accountCenter.reset 3h0m',
        'accountCenter.reset 4d0h',
        'accountCenter.subscription 30d0h',
      ]);
      const identityRow = renderer!.root.findByType('h3').parent!;
      const metadata = identityRow.findAllByType('span')[0];
      expect(
        metadata
          .findAllByType('span')
          .flatMap((node) => node.children.filter((child) => child === 'Plus' || child === '30d0h'))
      ).toEqual(['30d0h', 'Plus']);
      expect(identityRow.findAllByType('svg')).toHaveLength(0);
    } finally {
      act(() => renderer?.unmount());
      vi.useRealTimers();
    }
  });

  it('shows only the weekly quota for Pro and preserves a Free 30-day quota as usage', () => {
    const state = context();
    state.codexAccounts = [
      {
        id: 'paid',
        email: 'paid@example.test',
        plan: 'prolite',
        active: true,
        quotaWindows: [{ label: '7d', remainingPercent: 59, resetAt: 123 }],
      },
      {
        id: 'free',
        email: 'free@example.test',
        plan: 'free',
        active: false,
        quotaWindows: [{ label: '30d', remainingPercent: 100, resetAt: 456 }],
      },
    ];
    const [paid, free] = providers(state)[0].accounts;
    expect(paid.plan).toBe('Pro 100');
    expect(paid.metrics).toMatchObject([{ label: '7d', value: '59%', percent: 59, resetAt: 123 }]);
    expect(paid.subscriptionEndAt).toBeNull();
    expect(free.metrics).toMatchObject([{ label: '30d', percent: 100, resetAt: 456 }]);
    expect(free.subscriptionEndAt).toBeUndefined();
  });

  it.each(['prolite', 'pro', 'promax'])(
    'shows one weekly row for %s even with cached short-window data',
    (plan) => {
      const state = context();
      state.codexAccounts = [
        {
          id: 'pro',
          email: 'pro@example.test',
          plan,
          active: false,
          quotaWindows: [
            { label: '5h', remainingPercent: 0, resetAt: 456 },
            { label: '7d', remainingPercent: 59, resetAt: 123 },
          ],
        },
      ];
      const provider = providers(state)[0];
      const account = provider.accounts[0];
      expect(account.metrics).toHaveLength(1);
      expect(account.metrics[0]).toMatchObject({
        label: '7d',
        value: '59%',
        percent: 59,
        resetAt: 123,
      });
      const markup = renderToStaticMarkup(<AccountCard provider={provider} account={account} />);
      expect(markup).not.toContain('>5h<');
      expect(markup).not.toContain('aria-label="5h pro@example.test"');
      expect(markup).toContain('aria-label="7d pro@example.test"');
      expect(markup).toContain('aria-valuenow="59"');
    }
  );

  it.each(['Plus', 'Business', undefined])(
    'includes a missing short-window row only for Plus (%s)',
    (plan) => {
      const state = context();
      state.codexAccounts = [
        {
          id: 'other',
          email: 'other@example.test',
          plan,
          active: false,
          quotaWindows: [{ label: '7d', remainingPercent: 59, resetAt: 123 }],
        },
      ];
      const metrics = providers(state)[0].accounts[0].metrics;
      expect(metrics.map((metric) => metric.label)).toEqual(
        plan === 'Plus' ? ['5h', '7d'] : ['7d']
      );
      if (plan === 'Plus')
        expect(metrics[0]).toMatchObject({
          label: '5h',
          value: '—',
          percent: undefined,
          resetAt: undefined,
        });
    }
  );

  it('keeps Pro weekly usage separate from cached short usage and leaves absent data unknown', () => {
    const state = context();
    state.codexAccounts = [
      {
        id: 'explicit',
        email: 'explicit@example.test',
        plan: 'pro',
        active: false,
        quotaWindows: [
          { label: '5h', remainingPercent: 0, resetAt: 123 },
          { label: '7d', remainingPercent: 59, resetAt: 456 },
        ],
      },
      { id: 'missing', email: 'missing@example.test', plan: 'pro', active: false },
    ];
    const [explicit, missing] = providers(state)[0].accounts;
    expect(explicit.metrics).toHaveLength(1);
    expect(explicit.metrics[0]).toMatchObject({
      label: '7d',
      value: '59%',
      percent: 59,
      resetAt: 456,
    });
    expect(missing.metrics).toHaveLength(1);
    expect(missing.metrics[0]).toMatchObject({
      value: '—',
      percent: undefined,
      resetAt: undefined,
    });
  });

  it('preserves ZCode paid subscription expiry separately from quota reset, with no trial subscription', () => {
    const state = context();
    state.zcodeAccounts.accounts = ['Pro', 'Trial'].map((plan) => ({
      id: plan,
      email: `${plan}@example.test`,
      provider: 'bigmodel',
      active: false,
      plan,
      subscriptionEndAt: 999,
      remainingPercent: 50,
      resetAt: 100,
    }));
    const [paid, trial] = providers(state).find((p) => p.id === 'zcode')!.accounts;
    expect(paid.subscriptionEndAt).toBe(999);
    expect(paid.metrics[0]).toMatchObject({ percent: 50, resetAt: 100 });
    expect(trial.subscriptionEndAt).toBeUndefined();
  });

  it('identifies each ZCode region without repeating it beside the plan or inventing an expiry', () => {
    const state = context();
    state.zcodeAccounts.accounts = [
      {
        id: 'cn',
        email: 'cn@example.test',
        provider: 'bigmodel',
        active: false,
        plan: null,
        remainingPercent: null,
        resetAt: null,
      },
      {
        id: 'global',
        email: 'global@example.test',
        provider: 'zai',
        active: false,
        plan: 'Trial',
        remainingPercent: null,
        resetAt: null,
      },
      {
        id: 'paid',
        email: 'paid@example.test',
        provider: 'zai',
        active: false,
        plan: 'ZCode Pro',
        remainingPercent: null,
        resetAt: null,
      },
    ];
    const provider = providers(state).find((p) => p.id === 'zcode')!;
    const [cn, global, paid] = provider.accounts;
    expect(cn.subscriptionEndAt).toBeUndefined();
    expect(global.subscriptionEndAt).toBeUndefined();
    expect(paid.subscriptionEndAt).toBeNull();
    expect(paid.plan).toBe('Pro');
    for (const account of provider.accounts) {
      const html = renderToStaticMarkup(<AccountCard provider={provider} account={account} />);
      expect(html).toContain(`aria-label="ZCode · ${account.detail} ${account.identity}"`);
      expect(html.split(`>${account.detail}<`)).toHaveLength(1);
      expect(html.includes('aria-label="accountCenter.subscription"')).toBe(account === paid);
    }
    expect(global.plan).toBe('agent.zcodeTrial');
  });
});
