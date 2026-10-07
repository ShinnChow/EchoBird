import React, { useLayoutEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import * as api from '../../api/tauri';
import { useToolsStore } from '../../stores/toolsStore';
import { useNavigationStore } from '../../stores/navigationStore';
import { AppManagerProvider } from '../../pages/AppManager/AppManagerProvider';
import { useAppManager } from '../../pages/AppManager/context';
import { CodexAccountSection } from './AppManagerComponents';
import { AccountSectionRow } from './AccountSectionPrimitives';
import {
  AccountCenterMain,
  AccountCenterPanel,
  AccountCenterTitleActions,
} from '../AccountCenter/AccountCenter';
import { open as folderPicker } from '@tauri-apps/plugin-dialog';
import { open as shellOpen } from '@tauri-apps/plugin-shell';

vi.hoisted(() => vi.stubGlobal('__APP_EDITION__', 'full'));
vi.mock('../../hooks/useI18n', () => {
  const t = (k: string) => k;
  return { useI18n: () => ({ t, locale: 'en' }) };
});
vi.mock('../../components/ConfirmDialog', () => ({ useConfirm: () => async () => true }));
vi.mock('../../components', () => ({ EFFORT_PULSE_ONESHOT_MS: 0 }));
vi.mock('../../pages/ModelNexus/context', () => {
  const userModels: never[] = [];
  return { useModelNexus: () => ({ userModels }) };
});
vi.mock('../../pages/FreeModels', () => ({ useFreeModels: () => ({ routerEnabled: false }) }));
vi.mock('../../pages/AppManager/ClaudeCodeLoginDialog', () => ({
  ClaudeCodeLoginDialog: () => null,
}));
vi.mock('@tauri-apps/plugin-shell', () => ({ open: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn().mockResolvedValue('E:/fixture-project'),
}));
vi.mock('../../api/tauri', () => {
  const names = [
    'listZCodeAccounts',
    'startZCodeLogin',
    'pollZCodeLogin',
    'cancelZCodeLogin',
    'switchZCodeAccount',
    'refreshZCodeAccountQuota',
    'deleteZCodeAccount',
    'startCodexLogin',
    'cancelCodexLogin',
    'listCodexAccounts',
    'deleteCodexAccount',
    'addCodexAccountViaOAuth',
    'switchCodexAccount',
    'refreshCodexAccountQuota',
    'listClaudeCodeAccounts',
    'deleteClaudeCodeAccount',
    'startClaudeCodeLogin',
    'cancelClaudeCodeLogin',
    'completeClaudeCodeLogin',
    'refreshClaudeCodeAccountQuota',
    'listWorkBuddyAccounts',
    'deleteWorkBuddyAccount',
    'startWorkBuddyLogin',
    'cancelWorkBuddyLogin',
    'pollWorkBuddyLogin',
    'refreshWorkBuddyAccountQuota',
    'claimWorkBuddyDailyCredits',
    'switchWorkBuddyAccount',
    'listDeepSeekAccounts',
    'deleteDeepSeekAccount',
    'startDeepSeekLogin',
    'cancelDeepSeekLogin',
    'pollDeepSeekLogin',
    'refreshDeepSeekAccountQuota',
    'switchDeepSeekAccount',
    'listGrokAccounts',
    'startGrokLogin',
    'cancelGrokLogin',
    'pollGrokLogin',
    'refreshGrokAccount',
    'switchGrokAccount',
    'deleteGrokAccount',
    'listManusAccounts',
    'startManusLogin',
    'cancelManusLogin',
    'pollManusLogin',
    'refreshManusAccount',
    'switchManusAccount',
    'deleteManusAccount',
    'listCursorAccounts',
    'startCursorLogin',
    'cancelCursorLogin',
    'pollCursorLogin',
    'refreshCursorAccount',
    'switchCursorAccount',
    'listGrokBotAccounts',
    'startGrokBotLogin',
    'cancelGrokBotLogin',
    'pollGrokBotLogin',
    'refreshGrokBotAccount',
    'deleteGrokBotAccount',
    'deleteCursorAccount',
    'listAntigravityAccounts',
    'startAntigravityLogin',
    'cancelAntigravityLogin',
    'pollAntigravityLogin',
    'refreshAntigravityAccount',
    'switchAntigravityAccount',
    'deleteAntigravityAccount',
    'startTool',
    'openExternal',
    'restoreToolToOfficial',
  ];
  return {
    ...Object.fromEntries(names.map((n) => [n, vi.fn()])),
    getModels: vi.fn().mockResolvedValue([]),
    getInstallIndex: vi.fn().mockResolvedValue('{"ids":[]}'),
  };
});

let renderer: ReactTestRenderer;
let state: ReturnType<typeof useAppManager>;
function Harness({ center = false, desktop = false }: { center?: boolean; desktop?: boolean }) {
  const ctx = useAppManager();
  useLayoutEffect(() => {
    state = ctx;
  });
  return center || desktop ? (
    <>
      {center && (
        <>
          <AccountCenterTitleActions />
          <AccountCenterMain />
          <AccountCenterPanel />
        </>
      )}
      {desktop && <CodexAccountSection />}
    </>
  ) : null;
}
const listNames = [
  'listZCodeAccounts',
  'listCodexAccounts',
  'listClaudeCodeAccounts',
  'listWorkBuddyAccounts',
  'listDeepSeekAccounts',
  'listGrokAccounts',
  'listManusAccounts',
  'listCursorAccounts',
  'listGrokBotAccounts',
  'listAntigravityAccounts',
] as const;
const listFor = {
  zcode: 'listZCodeAccounts',
  codex: 'listCodexAccounts',
  chatgptdesktop: 'listCodexAccounts',
  claudecode: 'listClaudeCodeAccounts',
  workbuddy: 'listWorkBuddyAccounts',
  workbuddyai: 'listWorkBuddyAccounts',
  dsh: 'listDeepSeekAccounts',
  grok: 'listGrokAccounts',
  manus: 'listManusAccounts',
  cursor: 'listCursorAccounts',
  grokbot: 'listGrokBotAccounts',
  antigravity: 'listAntigravityAccounts',
  antigravitydesktop: 'listAntigravityAccounts',
} as const;
type Tool = keyof typeof listFor;
async function tick() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
}
async function mount(tool: Tool, installed = true) {
  useToolsStore.getState().setDetectedTools([
    {
      id: tool,
      name: tool,
      category: tool === 'grok' || tool === 'antigravity' ? 'CLI Code' : 'Desktop',
      noModelConfig: ['antigravity', 'antigravitydesktop', 'cursor'].includes(tool),
      installed,
    },
  ]);
  await act(async () => {
    renderer = create(
      <AppManagerProvider>
        <Harness />
      </AppManagerProvider>
    );
  });
  act(() => {
    if (!installed) state.setViewMode('install');
    state.setSelectedTool(tool);
  });
  await tick();
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  for (const name of listNames) vi.mocked(api[name]).mockResolvedValue([]);
  vi.mocked(api.cancelClaudeCodeLogin).mockResolvedValue(undefined);
  vi.mocked(api.startCodexLogin).mockResolvedValue('fixture-login');
  vi.mocked(api.cancelCodexLogin).mockResolvedValue(undefined);
  vi.mocked(api.restoreToolToOfficial).mockResolvedValue({ success: true, message: '' });
  vi.mocked(api.startTool).mockResolvedValue(undefined);
  vi.mocked(folderPicker).mockResolvedValue('E:/fixture-project');
  useNavigationStore.getState().setActivePage('apps');
});

async function showAccountCenter(tools: Tool[]) {
  await mount(tools[0]);
  act(() => {
    useToolsStore.getState().setDetectedTools(
      tools.map((id) => ({
        id,
        name: id,
        category: 'Desktop',
        installed: true,
      }))
    );
    useNavigationStore.getState().setActivePage('accounts');
  });
  await tick();
  await act(async () => {
    renderer.update(
      <AppManagerProvider>
        <Harness center />
      </AppManagerProvider>
    );
  });
}

function mockAccountOrderStorage(raw?: string) {
  const values = new Map(raw ? [['echobird_account_card_order', raw]] : []);
  const storage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => void values.set(key, value)),
  };
  vi.stubGlobal('localStorage', storage);
  return storage;
}

function accountCardIds() {
  return renderer.root
    .findByType(AccountCenterMain)
    .findAll((node) => node.type === 'div' && node.props['data-sortable-card'])
    .map((node) => node.props['data-sortable-card']);
}

function accountCardDnd() {
  return renderer.root
    .findByType(AccountCenterMain)
    .find((node) => typeof node.props.onDragEnd === 'function');
}

function dropAccountCard(activeId: string, overId: string | null) {
  act(() => {
    accountCardDnd().props.onDragEnd({
      active: { id: activeId },
      over: overId == null ? null : { id: overId },
    });
  });
}

it('Account Center: saves cross-provider card order, restores it on remount and isolates refresh', async () => {
  const storage = mockAccountOrderStorage();
  const first = { id: 'same', email: 'first@example.test', active: false };
  const second = { id: 'second', email: 'second@example.test', active: false };
  vi.mocked(api.listCodexAccounts).mockResolvedValue([first, second]);
  vi.mocked(api.listDeepSeekAccounts).mockResolvedValue([
    { id: 'same', name: 'DeepSeek', active: false, balances: null },
  ]);
  await showAccountCenter(['codex', 'dsh']);
  expect(accountCardIds()).toEqual(['codex:same', 'codex:second', 'dsh:same']);
  expect(storage.setItem).not.toHaveBeenCalled();
  dropAccountCard('dsh:same', 'codex:same');
  const order = ['dsh:same', 'codex:same', 'codex:second'];
  expect(accountCardIds()).toEqual(order);
  expect(storage.setItem).toHaveBeenCalledExactlyOnceWith(
    'echobird_account_card_order',
    JSON.stringify(order)
  );
  act(() =>
    renderer.update(
      <AppManagerProvider>
        <Harness />
      </AppManagerProvider>
    )
  );
  act(() =>
    renderer.update(
      <AppManagerProvider>
        <Harness center />
      </AppManagerProvider>
    )
  );
  expect(accountCardIds()).toEqual(order);
  for (const [key, action] of Object.entries(api))
    if (/^(start|refresh|switch|delete|claim|restore)/.test(key) && vi.isMockFunction(action))
      expect(action).not.toHaveBeenCalled();
  const grip = renderer.root.findByProps({ 'aria-label': 'model.dragSort first@example.test' });
  const refresh = renderer.root.findByProps({
    'aria-label': 'agent.refreshAccount first@example.test',
  });
  expect(grip.props.onPointerDown).toBeTypeOf('function');
  expect(refresh.props.onPointerDown).toBeUndefined();
  vi.mocked(api.refreshCodexAccountQuota).mockResolvedValue({ ...first, quotaPercent: 80 });
  await act(async () => refresh.props.onClick({ stopPropagation: vi.fn() }));
  expect(api.refreshCodexAccountQuota).toHaveBeenCalledExactlyOnceWith('same');
  expect(accountCardIds()).toEqual(order);
  expect(storage.setItem).toHaveBeenCalledTimes(1);
});

it('Account Center: saved ordering ignores deleted cards and appends new accounts after reload', async () => {
  const storage = mockAccountOrderStorage(
    JSON.stringify(['dsh:deleted', 'codex:second', 'codex:first'])
  );
  vi.mocked(api.listCodexAccounts).mockResolvedValue([
    { id: 'first', email: 'first@example.test', active: false },
    { id: 'second', email: 'second@example.test', active: false },
    { id: 'new', email: 'new@example.test', active: false },
  ]);
  await showAccountCenter(['codex']);
  expect(accountCardIds()).toEqual(['codex:second', 'codex:first', 'codex:new']);
  expect(storage.setItem).not.toHaveBeenCalled();
  vi.mocked(api.listCodexAccounts).mockResolvedValue([
    { id: 'first', email: 'first@example.test', active: false },
    { id: 'new', email: 'new@example.test', active: false },
  ]);
  act(() => useNavigationStore.getState().setActivePage('models'));
  await tick();
  act(() => useNavigationStore.getState().setActivePage('accounts'));
  await tick();
  expect(accountCardIds()).toEqual(['codex:first', 'codex:new']);
  expect(storage.setItem).not.toHaveBeenCalled();
  expect(api.refreshCodexAccountQuota).not.toHaveBeenCalled();
  expect(api.deleteCodexAccount).not.toHaveBeenCalled();
});

it('Account Center: desktop rows follow a live reorder and aliases without changing selection or native accounts', async () => {
  const storage = mockAccountOrderStorage();
  const rows: api.CodexAccount[] = [
    { id: 'first', email: 'first@example.test', active: true },
    { id: 'second', email: 'second@example.test', active: false },
  ];
  vi.mocked(api.listCodexAccounts).mockResolvedValue(rows);
  await showAccountCenter(['codex', 'chatgptdesktop']);
  act(() =>
    renderer.update(
      <AppManagerProvider>
        <Harness center desktop />
      </AppManagerProvider>
    )
  );
  const desktopRows = () =>
    renderer.root.findByType(CodexAccountSection).findAllByType(AccountSectionRow);
  expect(desktopRows().map((row) => row.props.email)).toEqual(rows.map((row) => row.email));
  expect(state.selectedCodexAccountId).toBe('first');
  dropAccountCard('codex:second', 'codex:first');
  expect(desktopRows().map((row) => row.props.email)).toEqual([
    'second@example.test',
    'first@example.test',
  ]);
  expect(desktopRows().map((row) => row.props.selected)).toEqual([false, true]);
  expect(rows.map((row) => row.id)).toEqual(['first', 'second']);
  expect(storage.setItem).toHaveBeenCalledTimes(1);
  act(() => {
    useNavigationStore.getState().setActivePage('apps');
    state.setSelectedTool('chatgptdesktop');
    renderer.update(
      <AppManagerProvider>
        <Harness desktop />
      </AppManagerProvider>
    );
  });
  await tick();
  expect(desktopRows().map((row) => row.props.email)).toEqual([
    'second@example.test',
    'first@example.test',
  ]);
  expect(state.selectedCodexAccountId).toBe('first');
  for (const [key, action] of Object.entries(api))
    if (/^(start|refresh|switch|delete|claim|restore)/.test(key) && vi.isMockFunction(action))
      expect(action).not.toHaveBeenCalled();
  expect(storage.setItem).toHaveBeenCalledTimes(1);
  vi.mocked(api.refreshCodexAccountQuota).mockResolvedValue({ ...rows[0], quotaPercent: 80 });
  await act(async () => desktopRows()[1].props.onRefresh());
  expect(api.refreshCodexAccountQuota).toHaveBeenCalledExactlyOnceWith('first');
  expect(state.codexAccounts.map((row) => row.id)).toEqual(['second', 'first']);
  expect(state.codexAccounts[1].quotaPercent).toBe(80);
  act(() => useNavigationStore.getState().setActivePage('accounts'));
  await tick();
  act(() =>
    renderer.update(
      <AppManagerProvider>
        <Harness center />
      </AppManagerProvider>
    )
  );
  expect(accountCardIds()).toEqual(['codex:second', 'codex:first']);
  act(() => renderer.unmount());
  await mount('chatgptdesktop');
  act(() =>
    renderer.update(
      <AppManagerProvider>
        <Harness desktop />
      </AppManagerProvider>
    )
  );
  expect(desktopRows().map((row) => row.props.email)).toEqual([
    'second@example.test',
    'first@example.test',
  ]);
  expect(storage.setItem).toHaveBeenCalledTimes(1);
});

it('App Desktop: saved order applies to every provider and edition with duplicate IDs, leaving new rows at the end', async () => {
  const scopes = [
    'codex',
    'claudecode',
    'workbuddy',
    'workbuddyai',
    'dsh',
    'antigravity',
    'cursor',
    'zcode',
    'grok',
    'grokbot',
    'manus',
  ];
  const expected = (index: number) =>
    index % 2 ? ['first', 'second', 'new'] : ['second', 'first', 'new'];
  const storage = mockAccountOrderStorage(
    JSON.stringify(
      scopes.flatMap((scope, index) =>
        expected(index)
          .slice(0, 2)
          .map((id) => `${scope}:${id}`)
      )
    )
  );
  const rows = ['first', 'second', 'new'].map((id) => ({
    id,
    email: `${id}@example.test`,
    name: id,
    active: false,
    plan: null,
  }));
  vi.mocked(api.listCodexAccounts).mockResolvedValue(rows as never);
  vi.mocked(api.listClaudeCodeAccounts).mockResolvedValue(rows as never);
  vi.mocked(api.listWorkBuddyAccounts).mockImplementation(async (edition) =>
    rows.map((row) => ({ ...rewardAccount, ...row, edition }))
  );
  vi.mocked(api.listDeepSeekAccounts).mockResolvedValue(
    rows.map((row) => ({ ...row, balances: null }))
  );
  vi.mocked(api.listAntigravityAccounts).mockResolvedValue(
    rows.map((row) => ({ ...row, quotas: [] }))
  );
  vi.mocked(api.listCursorAccounts).mockResolvedValue(rows as never);
  vi.mocked(api.listZCodeAccounts).mockResolvedValue(rows.map((row) => ({ ...zcodeRow, ...row })));
  vi.mocked(api.listGrokAccounts).mockResolvedValue(rows as never);
  vi.mocked(api.listGrokBotAccounts).mockResolvedValue(rows as never);
  vi.mocked(api.listManusAccounts).mockResolvedValue(rows as never);
  await showAccountCenter(Object.keys(listFor) as Tool[]);
  const groups = [
    state.codexAccounts,
    state.claudeCodeAccounts.accounts,
    state.workBuddyAccountGroups.workbuddy.accounts,
    state.workBuddyAccountGroups.workbuddyai.accounts,
    state.deepSeekAccounts.accounts,
    state.antigravityAccounts.accounts,
    state.cursorAccounts.accounts,
    state.zcodeAccounts.accounts,
    state.grokAccounts.accounts,
    state.grokBotAccounts.accounts,
    state.manusAccounts.accounts,
  ];
  groups.forEach((accounts, index) =>
    expect(accounts.map((account) => account.id)).toEqual(expected(index))
  );
  for (const [tool, scope] of [
    ['workbuddy', 'workbuddy'],
    ['workbuddyai', 'workbuddyai'],
  ] as const) {
    act(() => state.setSelectedTool(tool));
    await tick();
    expect(state.workBuddyAccounts.accounts.map((account) => account.id)).toEqual(
      expected(scopes.indexOf(scope))
    );
  }
  expect(rows.map((row) => row.id)).toEqual(['first', 'second', 'new']);
  expect(storage.setItem).not.toHaveBeenCalled();
  for (const [key, action] of Object.entries(api))
    if (/^(start|refresh|switch|delete|claim|restore)/.test(key) && vi.isMockFunction(action))
      expect(action).not.toHaveBeenCalled();
});

it('Account Center: cancelled, invalid and late drops do not save an order', async () => {
  const storage = mockAccountOrderStorage();
  vi.mocked(api.listCodexAccounts).mockResolvedValue([
    { id: 'first', email: 'first@example.test', active: false },
    { id: 'second', email: 'second@example.test', active: false },
  ]);
  await showAccountCenter(['codex']);
  const dnd = accountCardDnd();
  act(() => {
    dnd.props.onDragStart({ active: { id: 'codex:first' } });
    dnd.props.onDragCancel();
  });
  for (const target of [null, 'codex:missing', 'codex:first'])
    dropAccountCard('codex:first', target);
  act(() => useNavigationStore.getState().setActivePage('models'));
  dropAccountCard('codex:first', 'codex:second');
  await tick();
  act(() => useNavigationStore.getState().setActivePage('accounts'));
  await tick();
  expect(accountCardIds()).toEqual(['codex:first', 'codex:second']);
  expect(storage.setItem).not.toHaveBeenCalled();
});

it('Account Center: pending account reload disables sorting without rewriting the saved order', async () => {
  const storage = mockAccountOrderStorage();
  const rows = [
    { id: 'first', email: 'first@example.test', active: false },
    { id: 'second', email: 'second@example.test', active: false },
  ];
  vi.mocked(api.listCodexAccounts).mockResolvedValue(rows);
  await showAccountCenter(['codex']);
  act(() => useNavigationStore.getState().setActivePage('models'));
  await tick();
  let resolve!: (rows: api.CodexAccount[]) => void;
  vi.mocked(api.listCodexAccounts).mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    })
  );
  act(() => useNavigationStore.getState().setActivePage('accounts'));
  await tick();
  const grip = renderer.root.findByProps({ 'aria-label': 'model.dragSort first@example.test' });
  expect(grip.props.disabled).toBe(true);
  dropAccountCard('codex:first', 'codex:second');
  expect(accountCardIds()).toEqual(['codex:first', 'codex:second']);
  expect(storage.setItem).not.toHaveBeenCalled();
  await act(async () => resolve(rows));
  expect(grip.props.disabled).toBe(false);
});

it.each(['{invalid', '{}', '[12,null]'])(
  'Account Center: malformed saved card order falls back without a write (%s)',
  async (raw) => {
    const storage = mockAccountOrderStorage(raw);
    vi.mocked(api.listCodexAccounts).mockResolvedValue([
      { id: 'first', email: 'first@example.test', active: false },
      { id: 'second', email: 'second@example.test', active: false },
    ]);
    await showAccountCenter(['codex']);
    expect(accountCardIds()).toEqual(['codex:first', 'codex:second']);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(state.applyError).toBeNull();
  }
);

it('Account Center: unavailable order storage keeps sorting usable for the current session', async () => {
  const storage = mockAccountOrderStorage();
  storage.getItem.mockImplementation(() => {
    throw new Error('unavailable');
  });
  storage.setItem.mockImplementation(() => {
    throw new Error('unavailable');
  });
  vi.mocked(api.listCodexAccounts).mockResolvedValue([
    { id: 'first', email: 'first@example.test', active: false },
    { id: 'second', email: 'second@example.test', active: false },
  ]);
  await showAccountCenter(['codex']);
  dropAccountCard('codex:first', 'codex:second');
  expect(accountCardIds()).toEqual(['codex:second', 'codex:first']);
  expect(state.codexAccounts.map((account) => account.id)).toEqual(['second', 'first']);
  act(() =>
    renderer.update(
      <AppManagerProvider>
        <Harness />
      </AppManagerProvider>
    )
  );
  act(() =>
    renderer.update(
      <AppManagerProvider>
        <Harness center />
      </AppManagerProvider>
    )
  );
  expect(accountCardIds()).toEqual(['codex:second', 'codex:first']);
  expect(state.applyError).toBeNull();
  expect(api.refreshCodexAccountQuota).not.toHaveBeenCalled();
});

const rewardAccount: api.WorkBuddyAccount = {
  id: 'reward',
  name: 'Reward',
  edition: 'workbuddy',
  active: false,
  plan: 'Free',
  remaining: 50,
  total: 500,
  rewardRemaining: 50,
  rewardTotal: 500,
  expiresAt: null,
};

it('Account Center: individual/batch rewards share locks, skip claimed/international accounts and preserve partial failures', async () => {
  const now = Date.now() / 1000;
  const rows = ['manual', 'failed', 'success', 'claimed'].map((id) => ({
    ...rewardAccount,
    id,
    name: id,
    dailyClaimedAt: id === 'claimed' ? now : null,
  }));
  const international = {
    ...rewardAccount,
    id: 'global',
    name: 'global',
    edition: 'workbuddyai' as const,
  };
  vi.mocked(api.listWorkBuddyAccounts).mockImplementation(async (edition) =>
    edition === 'workbuddy' ? rows : [international]
  );
  await showAccountCenter(['workbuddy', 'workbuddyai']);
  expect(api.claimWorkBuddyDailyCredits).not.toHaveBeenCalled();
  const claimAll = renderer.root.findByProps({ 'aria-label': 'accountCenter.claimAll' });
  expect(claimAll.props.disabled).toBe(false);
  expect(
    renderer.root.findAll(
      (node) =>
        node.type === 'button' && node.props['aria-label'] === 'agent.claimDailyCredits global'
    )
  ).toHaveLength(0);
  expect(
    renderer.root.findByProps({ 'aria-label': 'agent.dailyCreditsClaimed claimed' }).props.disabled
  ).toBe(true);
  let resolve!: (row: api.WorkBuddyAccount) => void;
  vi.mocked(api.claimWorkBuddyDailyCredits).mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    })
  );
  const manual = renderer.root.findByProps({ 'aria-label': 'agent.claimDailyCredits manual' });
  const stopPropagation = vi.fn();
  act(() => manual.props.onClick({ stopPropagation }));
  expect(stopPropagation).toHaveBeenCalledOnce();
  expect(claimAll.props.disabled).toBe(true);
  await act(async () => {
    await claimAll.props.onClick();
    await state.workBuddyAccountGroups.workbuddy.claimDaily(rows[0]);
    await state.workBuddyAccountGroups.workbuddy.refresh(rows[0]);
  });
  expect(api.claimWorkBuddyDailyCredits).toHaveBeenCalledExactlyOnceWith('workbuddy', 'manual');
  expect(api.refreshWorkBuddyAccountQuota).not.toHaveBeenCalled();
  await act(async () => {
    resolve({ ...rows[0], rewardRemaining: 100, dailyClaimedAt: now });
  });
  expect(
    renderer.root.findByProps({ 'aria-label': 'agent.dailyCreditsClaimed manual' }).props.disabled
  ).toBe(true);
  vi.mocked(api.claimWorkBuddyDailyCredits).mockImplementation(async (_edition, id) => {
    if (id === 'failed') throw new Error('accountError.claim');
    return { ...rows.find((row) => row.id === id)!, rewardRemaining: 200, dailyClaimedAt: now };
  });
  await act(async () => {
    await claimAll.props.onClick();
  });
  expect(vi.mocked(api.claimWorkBuddyDailyCredits).mock.calls).toEqual([
    ['workbuddy', 'manual'],
    ['workbuddy', 'failed'],
    ['workbuddy', 'success'],
  ]);
  expect(
    state.workBuddyAccountGroups.workbuddy.accounts.find((row) => row.id === 'failed')
  ).toEqual(rows[1]);
  expect(
    state.workBuddyAccountGroups.workbuddy.accounts.find((row) => row.id === 'success')
      ?.rewardRemaining
  ).toBe(200);
  expect(state.applyError).toBe('accountError.claim');
  expect(claimAll.props.disabled).toBe(false);
  expect(api.switchWorkBuddyAccount).not.toHaveBeenCalled();
  expect(api.startTool).not.toHaveBeenCalled();
  expect(api.openExternal).not.toHaveBeenCalled();
});

it('Account Center: refreshes all installed account groups sequentially once and keeps failed rows', async () => {
  const first: api.CodexAccount = {
    id: 'first',
    email: 'first@example.test',
    active: false,
    quotaPercent: 10,
  };
  const second: api.CodexAccount = {
    id: 'second',
    email: 'second@example.test',
    active: false,
    quotaPercent: 20,
  };
  const generic = {
    id: 'saved',
    email: 'saved@example.test',
    name: 'saved',
    active: false,
    plan: null,
  };
  vi.mocked(api.listCodexAccounts).mockResolvedValue([first, second]);
  vi.mocked(api.listWorkBuddyAccounts).mockImplementation(async (edition) => [
    { ...rewardAccount, edition },
  ]);
  vi.mocked(api.listClaudeCodeAccounts).mockResolvedValue([generic] as never);
  vi.mocked(api.listDeepSeekAccounts).mockResolvedValue([{ ...generic, balances: null }]);
  vi.mocked(api.listAntigravityAccounts).mockResolvedValue([{ ...generic, quotas: [] }]);
  vi.mocked(api.listCursorAccounts).mockResolvedValue([generic] as never);
  vi.mocked(api.listZCodeAccounts).mockResolvedValue([zcodeRow]);
  vi.mocked(api.listGrokAccounts).mockResolvedValue([generic] as never);
  vi.mocked(api.listGrokBotAccounts).mockResolvedValue([generic] as never);
  vi.mocked(api.listManusAccounts).mockResolvedValue([generic] as never);
  await showAccountCenter(Object.keys(listFor) as Tool[]);
  act(() =>
    useToolsStore
      .getState()
      .setDetectedTools(
        useToolsStore
          .getState()
          .detectedTools.map((tool) => ({ ...tool, installed: tool.id !== 'cursor' }))
      )
  );
  await tick();
  const actions = [
    'refreshClaudeCodeAccountQuota',
    'refreshDeepSeekAccountQuota',
    'refreshWorkBuddyAccountQuota',
    'refreshAntigravityAccount',
    'refreshZCodeAccountQuota',
    'refreshGrokAccount',
    'refreshGrokBotAccount',
    'refreshManusAccount',
  ] as const;
  for (const name of actions) expect(api[name]).not.toHaveBeenCalled();
  let reject!: (error: Error) => void;
  vi.mocked(api.refreshCodexAccountQuota)
    .mockReturnValueOnce(
      new Promise((_, fail) => {
        reject = fail;
      })
    )
    .mockResolvedValue({ ...second, quotaPercent: 80 });
  vi.mocked(api.refreshClaudeCodeAccountQuota).mockResolvedValue(generic as never);
  vi.mocked(api.refreshDeepSeekAccountQuota).mockResolvedValue({ ...generic, balances: [] });
  vi.mocked(api.refreshWorkBuddyAccountQuota).mockImplementation(async (edition) => ({
    ...rewardAccount,
    edition,
    remaining: 200,
  }));
  vi.mocked(api.refreshAntigravityAccount).mockResolvedValue({ ...generic, quotas: [] });
  vi.mocked(api.refreshZCodeAccountQuota).mockResolvedValue(zcodeRow);
  vi.mocked(api.refreshGrokAccount).mockResolvedValue(generic as never);
  vi.mocked(api.refreshGrokBotAccount).mockResolvedValue(generic as never);
  vi.mocked(api.refreshManusAccount).mockResolvedValue(generic as never);
  const refreshAll = renderer.root.findByProps({ 'aria-label': 'accountCenter.refreshAll' });
  let task!: Promise<void>;
  act(() => {
    task = refreshAll.props.onClick();
    void refreshAll.props.onClick();
  });
  expect(api.refreshCodexAccountQuota).toHaveBeenCalledExactlyOnceWith('first');
  for (const name of actions) expect(api[name]).not.toHaveBeenCalled();
  expect(refreshAll.props.disabled).toBe(true);
  expect(renderer.root.findByProps({ 'aria-label': 'accountCenter.claimAll' }).props.disabled).toBe(
    true
  );
  await act(async () => {
    reject(new Error('accountError.quota'));
    await task;
  });
  expect(vi.mocked(api.refreshCodexAccountQuota).mock.calls).toEqual([['first'], ['second']]);
  expect(state.codexAccounts[0]).toEqual(first);
  expect(state.codexAccounts[1].quotaPercent).toBe(80);
  for (const name of actions)
    expect(api[name]).toHaveBeenCalledTimes(name === 'refreshWorkBuddyAccountQuota' ? 2 : 1);
  expect(vi.mocked(api.refreshWorkBuddyAccountQuota).mock.calls).toEqual([
    ['workbuddy', rewardAccount.id],
    ['workbuddyai', rewardAccount.id],
  ]);
  expect(api.refreshDeepSeekAccountQuota).toHaveBeenCalledWith('saved', 'en');
  expect(api.refreshCursorAccount).not.toHaveBeenCalled();
  expect(api.claimWorkBuddyDailyCredits).not.toHaveBeenCalled();
  expect(api.startTool).not.toHaveBeenCalled();
  expect(api.openExternal).not.toHaveBeenCalled();
  for (const [key, action] of Object.entries(api))
    if (key.startsWith('switch') && vi.isMockFunction(action))
      expect(action).not.toHaveBeenCalled();
  expect(state.applyError).toBe('agent.refreshAccountFailed');
  expect(refreshAll.props.disabled).toBe(false);
});

it.each([false, true])(
  'Account Center: leaving stops a batch and ignores its late result, including after re-entry (failure=%s)',
  async (failure) => {
    const rows: api.CodexAccount[] = [
      { id: 'first', email: 'first@example.test', active: false, quotaPercent: 10 },
      { id: 'second', email: 'second@example.test', active: false, quotaPercent: 20 },
    ];
    vi.mocked(api.listCodexAccounts).mockResolvedValue(rows);
    await showAccountCenter(['codex']);
    let resolve!: (row: api.CodexAccount) => void;
    vi.mocked(api.refreshCodexAccountQuota).mockImplementationOnce(async () => {
      const result = await new Promise<api.CodexAccount>((done) => {
        resolve = done;
      });
      if (failure) throw new Error('accountError.quota');
      return result;
    });
    const refreshAll = renderer.root.findByProps({ 'aria-label': 'accountCenter.refreshAll' });
    let task!: Promise<void>;
    act(() => {
      task = refreshAll.props.onClick();
    });
    act(() => useNavigationStore.getState().setActivePage('models'));
    await tick();
    act(() => useNavigationStore.getState().setActivePage('accounts'));
    await tick();
    await act(async () => {
      resolve({ ...rows[0], quotaPercent: 99 });
      await task;
    });
    expect(api.refreshCodexAccountQuota).toHaveBeenCalledExactlyOnceWith('first');
    expect(state.codexAccounts).toEqual(rows);
    expect(state.applyError).toBeNull();
    expect(refreshAll.props.disabled).toBe(false);
    vi.mocked(api.refreshCodexAccountQuota).mockImplementation(async (id) => ({
      ...rows.find((row) => row.id === id)!,
      quotaPercent: 100,
    }));
    await act(async () => {
      await refreshAll.props.onClick();
    });
    expect(vi.mocked(api.refreshCodexAccountQuota).mock.calls).toEqual([
      ['first'],
      ['first'],
      ['second'],
    ]);
  }
);

it('Account Center: China day rollover enables rewards without auto claiming or refreshing', async () => {
  vi.setSystemTime(new Date('2026-10-07T15:59:30Z'));
  const row = { ...rewardAccount, dailyClaimedAt: Date.now() / 1000 };
  vi.mocked(api.listWorkBuddyAccounts).mockResolvedValue([row]);
  await showAccountCenter(['workbuddy']);
  expect(
    renderer.root.findByProps({ 'aria-label': 'agent.dailyCreditsClaimed Reward' }).props.disabled
  ).toBe(true);
  const claimAll = renderer.root.findByProps({ 'aria-label': 'accountCenter.claimAll' });
  expect(claimAll.props.disabled).toBe(true);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(
    renderer.root.findByProps({ 'aria-label': 'agent.claimDailyCredits Reward' }).props.disabled
  ).toBe(false);
  expect(claimAll.props.disabled).toBe(false);
  expect(api.claimWorkBuddyDailyCredits).not.toHaveBeenCalled();
  expect(api.refreshWorkBuddyAccountQuota).not.toHaveBeenCalled();
  expect(api.startTool).not.toHaveBeenCalled();
});

it.each(['claudecode', 'workbuddy', 'dsh', 'chatgptdesktop'] as const)(
  '%s: leaving the page cancels login and ignores its late failure',
  async (tool) => {
    let reject!: (error: Error) => void;
    const pending = new Promise<never>((_, fail) => {
      reject = fail;
    });
    const expiresAt = Date.now() / 1000 + 60;
    vi.mocked(api.startClaudeCodeLogin).mockResolvedValue({
      loginId: 'login',
      authorizationUrl: 'https://example.test',
      expiresAt,
    });
    vi.mocked(api.startWorkBuddyLogin).mockResolvedValue({
      loginId: 'login',
      verificationUri: 'https://example.test',
      expiresAt,
    });
    vi.mocked(api.startDeepSeekLogin).mockResolvedValue({
      loginId: 'login',
      verificationUri: 'https://example.test',
      expiresAt,
    });
    vi.mocked(api.cancelWorkBuddyLogin).mockResolvedValue(undefined);
    vi.mocked(api.cancelDeepSeekLogin).mockResolvedValue(undefined);
    await mount(tool);
    let task!: Promise<void>;
    await act(async () => {
      if (tool === 'claudecode') {
        await state.claudeCodeAccounts.add();
        vi.mocked(api.completeClaudeCodeLogin).mockReturnValueOnce(pending);
        task = state.claudeCodeAccounts.completeLogin('fixture-code');
      } else if (tool === 'workbuddy') {
        vi.mocked(api.pollWorkBuddyLogin).mockReturnValueOnce(pending);
        task = state.workBuddyAccounts.add();
      } else if (tool === 'dsh') {
        vi.mocked(api.pollDeepSeekLogin).mockReturnValueOnce(pending);
        task = state.deepSeekAccounts.add();
      } else {
        vi.mocked(api.addCodexAccountViaOAuth).mockReturnValueOnce(pending);
        task = state.addCodexAccount();
      }
    });
    act(() => useNavigationStore.getState().setActivePage('models'));
    await tick();
    const cancel = {
      claudecode: api.cancelClaudeCodeLogin,
      workbuddy: api.cancelWorkBuddyLogin,
      dsh: api.cancelDeepSeekLogin,
      chatgptdesktop: api.cancelCodexLogin,
    }[tool];
    expect(cancel).toHaveBeenCalledWith(tool === 'chatgptdesktop' ? 'fixture-login' : 'login');
    await act(async () => {
      reject(new Error('late failure'));
      await task;
    });
    expect(state.applyError).toBeNull();
    expect(state.claudeCodeAccounts.login).toBeNull();
  }
);

it.each(['claudecode', 'workbuddy', 'dsh', 'chatgptdesktop'] as const)(
  '%s: the 60 second deadline cancels an in-flight login request',
  async (tool) => {
    let resolve!: (account: never) => void;
    const pending = new Promise<never>((done) => {
      resolve = done;
    });
    const login = {
      loginId: 'login',
      verificationUri: 'https://example.test',
      expiresAt: Date.now() / 1000 + 600,
    };
    vi.mocked(api.startWorkBuddyLogin).mockResolvedValue(login);
    vi.mocked(api.startDeepSeekLogin).mockResolvedValue(login);
    vi.mocked(api.startClaudeCodeLogin).mockResolvedValue({
      ...login,
      authorizationUrl: 'https://example.test',
    });
    vi.mocked(api.cancelWorkBuddyLogin).mockResolvedValue(undefined);
    vi.mocked(api.cancelDeepSeekLogin).mockResolvedValue(undefined);
    await mount(tool);
    let task!: Promise<void>;
    await act(async () => {
      if (tool === 'claudecode') {
        await state.claudeCodeAccounts.add();
        vi.mocked(api.completeClaudeCodeLogin).mockReturnValueOnce(pending);
        task = state.claudeCodeAccounts.completeLogin('fixture-code');
      } else if (tool === 'workbuddy') {
        vi.mocked(api.pollWorkBuddyLogin).mockReturnValueOnce(pending);
        task = state.workBuddyAccounts.add();
      } else if (tool === 'dsh') {
        vi.mocked(api.pollDeepSeekLogin).mockReturnValueOnce(pending);
        task = state.deepSeekAccounts.add();
      } else {
        vi.mocked(api.addCodexAccountViaOAuth).mockReturnValueOnce(pending);
        task = state.addCodexAccount();
      }
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(state.applyError).toBe('accountError.expired');
    const cancel = {
      claudecode: api.cancelClaudeCodeLogin,
      workbuddy: api.cancelWorkBuddyLogin,
      dsh: api.cancelDeepSeekLogin,
      chatgptdesktop: api.cancelCodexLogin,
    }[tool];
    expect(cancel).toHaveBeenCalled();
    expect(
      state.claudeCodeAccounts.busy ||
        state.workBuddyAccounts.busy ||
        state.deepSeekAccounts.busy ||
        state.isAddingCodexAccount
    ).toBe(false);
    const before = vi.mocked(api[listFor[tool]]).mock.calls.length;
    await act(async () => {
      resolve({ id: 'late' } as never);
      await task;
    });
    expect(api[listFor[tool]]).toHaveBeenCalledTimes(before);
  }
);

it.each(['claudecode', 'workbuddy', 'dsh', 'chatgptdesktop'] as const)(
  '%s: explicit refresh reports errors and prevents duplicate requests',
  async (tool) => {
    await mount(tool);
    let reject!: (error: Error) => void;
    const pending = new Promise<never>((_, fail) => {
      reject = fail;
    });
    const quota = {
      claudecode: api.refreshClaudeCodeAccountQuota,
      workbuddy: api.refreshWorkBuddyAccountQuota,
      dsh: api.refreshDeepSeekAccountQuota,
      chatgptdesktop: api.refreshCodexAccountQuota,
    }[tool];
    vi.mocked(quota).mockReturnValueOnce(pending);
    const row = {
      id: 'quota-fixture',
      edition: 'workbuddy',
      email: 'fixture@example.test',
    } as never;
    const refresh = {
      claudecode: state.claudeCodeAccounts.refresh,
      workbuddy: state.workBuddyAccounts.refresh,
      dsh: state.deepSeekAccounts.refresh,
      chatgptdesktop: state.refreshCodexAccountQuota,
    }[tool];
    let task!: Promise<void>;
    act(() => {
      task = refresh(row);
      void refresh(row);
    });
    expect(quota).toHaveBeenCalledTimes(1);
    await act(async () => {
      reject(new Error('accountError.network'));
      await task;
    });
    expect(state.applyError).not.toBeNull();
  }
);

it.each(['workbuddy', 'dsh'] as const)(
  '%s: login expiry does not leave a concurrent quota refresh disabled',
  async (tool) => {
    const row = { id: 'fixture', edition: 'workbuddy' } as never;
    const login = {
      loginId: 'login',
      verificationUri: 'https://example.test',
      expiresAt: Date.now() / 1000 + 600,
    };
    let finishRefresh!: (row: never) => void;
    let finishLogin!: (row: null) => void;
    const quota = new Promise<never>((resolve) => {
      finishRefresh = resolve;
    });
    const pending = new Promise<null>((resolve) => {
      finishLogin = resolve;
    });
    vi.mocked(api.startWorkBuddyLogin).mockResolvedValue(login);
    vi.mocked(api.startDeepSeekLogin).mockResolvedValue(login);
    vi.mocked(api.cancelWorkBuddyLogin).mockResolvedValue(undefined);
    vi.mocked(api.cancelDeepSeekLogin).mockResolvedValue(undefined);
    vi.mocked(api.pollWorkBuddyLogin).mockReturnValue(pending);
    vi.mocked(api.pollDeepSeekLogin).mockReturnValue(pending);
    vi.mocked(
      tool === 'workbuddy' ? api.refreshWorkBuddyAccountQuota : api.refreshDeepSeekAccountQuota
    ).mockReturnValueOnce(quota);
    await mount(tool);
    const accountState = () =>
      tool === 'workbuddy' ? state.workBuddyAccounts : state.deepSeekAccounts;
    let loginTask!: Promise<void>;
    let refreshTask!: Promise<void>;
    await act(async () => {
      loginTask = accountState().add();
      refreshTask = accountState().refresh(row);
    });
    expect(accountState().refreshing.has('fixture')).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    await act(async () => {
      finishRefresh(row);
      finishLogin(null);
      await Promise.all([refreshTask, loginTask]);
    });
    expect(accountState().refreshing.size).toBe(0);
  }
);

it('Claude Code: timeout cancels a late login initialization without opening the browser', async () => {
  let resolve!: (login: api.ClaudeCodeLogin) => void;
  vi.mocked(api.startClaudeCodeLogin).mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    })
  );
  await mount('claudecode');
  let task!: Promise<void>;
  act(() => {
    task = state.claudeCodeAccounts.add();
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(state.claudeCodeAccounts.busy).toBe(false);
  await act(async () => {
    resolve({
      loginId: 'late',
      authorizationUrl: 'https://example.test',
      expiresAt: Date.now() / 1000 + 60,
    });
    await task;
  });
  expect(api.cancelClaudeCodeLogin).toHaveBeenCalledWith('late');
  expect(state.claudeCodeAccounts.login).toBeNull();
  expect(shellOpen).not.toHaveBeenCalled();
});

it('Grok Build: cancelling the directory picker prevents launch after account apply', async () => {
  vi.mocked(api.listGrokAccounts).mockResolvedValue([{ id: 'fixture', active: true }] as never);
  vi.mocked(folderPicker).mockResolvedValue(null);
  await mount('grok');
  await act(async () => {
    await state.handleLaunch();
  });
  expect(api.switchGrokAccount).toHaveBeenCalledWith('fixture');
  expect(folderPicker).toHaveBeenCalled();
  expect(api.startTool).not.toHaveBeenCalled();
});

it('Grok Build: apply-only does not ask for a directory or launch', async () => {
  vi.mocked(api.listGrokAccounts).mockResolvedValue([{ id: 'fixture', active: true }] as never);
  await mount('grok');
  act(() => state.setLaunchAfterApply(false));
  await act(async () => {
    await state.handleLaunch();
  });
  expect(api.switchGrokAccount).toHaveBeenCalledWith('fixture');
  expect(folderPicker).not.toHaveBeenCalled();
  expect(api.startTool).not.toHaveBeenCalled();
});
afterEach(() => {
  act(() => renderer?.unmount());
  useToolsStore.getState().setDetectedTools([]);
  vi.stubGlobal('localStorage', undefined);
  vi.useRealTimers();
});

it.each(Object.keys(listFor) as Tool[])(
  '%s: uninstalled navigation must not read native accounts',
  async (tool) => {
    await mount(tool, false);
    expect(api[listFor[tool]]).not.toHaveBeenCalled();
  }
);
it.each(Object.keys(listFor) as Tool[])(
  '%s: installed navigation only reads accounts',
  async (tool) => {
    await mount(tool);
    expect(api[listFor[tool]]).toHaveBeenCalledTimes(1);
    const actions = [
      api.startZCodeLogin,
      api.refreshZCodeAccountQuota,
      api.switchZCodeAccount,
      api.deleteZCodeAccount,
      api.startCodexLogin,
      api.startClaudeCodeLogin,
      api.startWorkBuddyLogin,
      api.startDeepSeekLogin,
      api.startGrokLogin,
      api.startCursorLogin,
      api.startGrokBotLogin,
      api.refreshCodexAccountQuota,
      api.refreshClaudeCodeAccountQuota,
      api.refreshWorkBuddyAccountQuota,
      api.claimWorkBuddyDailyCredits,
      api.refreshDeepSeekAccountQuota,
      api.refreshGrokAccount,
      api.refreshCursorAccount,
      api.refreshGrokBotAccount,
      api.switchCodexAccount,
      api.switchWorkBuddyAccount,
      api.switchGrokAccount,
      api.switchDeepSeekAccount,
      api.switchCursorAccount,
      api.switchAntigravityAccount,
      api.startAntigravityLogin,
      api.refreshAntigravityAccount,
      api.restoreToolToOfficial,
      api.startTool,
    ];
    for (const action of actions) expect(action).not.toHaveBeenCalled();
    act(() => state.setViewMode('install'));
    await tick();
    expect(api[listFor[tool]]).toHaveBeenCalledTimes(1);
    for (const action of actions) expect(action).not.toHaveBeenCalled();
  }
);
it.each(['claudecode', 'workbuddy', 'dsh', 'chatgptdesktop'] as const)(
  '%s: failed passive reload preserves cached accounts',
  async (tool) => {
    const row = { id: 'cached', active: true, edition: 'workbuddy' };
    vi.mocked(api[listFor[tool]]).mockResolvedValueOnce([row] as never);
    await mount(tool);
    const rows = () =>
      ({
        claudecode: state.claudeCodeAccounts.accounts,
        workbuddy: state.workBuddyAccounts.accounts,
        dsh: state.deepSeekAccounts.accounts,
        chatgptdesktop: state.codexAccounts,
      })[tool];
    expect(rows()).toEqual([row]);
    act(() => useNavigationStore.getState().setActivePage('models'));
    await tick();
    vi.mocked(api[listFor[tool]]).mockRejectedValueOnce(new Error('accountError.read'));
    act(() => useNavigationStore.getState().setActivePage('apps'));
    await tick();
    expect(api[listFor[tool]]).toHaveBeenCalledTimes(2);
    expect(rows()).toEqual([row]);
    expect(state.applyError).toBeNull();
  }
);
it.each(['claudecode', 'workbuddy', 'dsh', 'zcode'] as Tool[])(
  '%s: passive read failure must not show dialog',
  async (tool) => {
    vi.mocked(api[listFor[tool]]).mockRejectedValueOnce(new Error('accountError.read'));
    await mount(tool);
    expect(api[listFor[tool]]).toHaveBeenCalledTimes(1);
    expect(state.applyError).toBeNull();
  }
);
it.each(['stay', 'leave', 'retry'] as const)(
  'Claude Code: a cancellation failure is only shown for its current session (%s)',
  async (next) => {
    vi.mocked(api.startClaudeCodeLogin).mockResolvedValue({
      loginId: 'login',
      authorizationUrl: 'https://example.test',
      expiresAt: Date.now() / 1000 + 60,
    });
    await mount('claudecode');
    await act(async () => {
      await state.claudeCodeAccounts.add();
    });
    let reject!: (error: Error) => void;
    vi.mocked(api.cancelClaudeCodeLogin).mockReturnValueOnce(
      new Promise((_, fail) => {
        reject = fail;
      })
    );
    act(() => state.claudeCodeAccounts.cancelLogin());
    if (next === 'leave') {
      act(() => useNavigationStore.getState().setActivePage('models'));
      await tick();
    } else if (next === 'retry') {
      vi.mocked(api.startClaudeCodeLogin).mockResolvedValueOnce({
        loginId: 'new-login',
        authorizationUrl: 'https://example.test',
        expiresAt: Date.now() / 1000 + 60,
      });
      await act(async () => {
        await state.claudeCodeAccounts.add();
      });
    }
    await act(async () => {
      reject(new Error('accountError.network'));
    });
    if (next === 'stay') expect(state.applyError).not.toBeNull();
    else expect(state.applyError).toBeNull();
    if (next === 'retry') expect(state.claudeCodeAccounts.login?.loginId).toBe('new-login');
  }
);

it('Account Center: loads installed groups once, shared stores once, and WorkBuddy editions separately', async () => {
  await mount('dsh');
  act(() =>
    useToolsStore.getState().setDetectedTools(
      (Object.keys(listFor) as Tool[]).map((id) => ({
        id,
        name: id,
        category: 'Desktop',
        installed: true,
      }))
    )
  );
  vi.clearAllMocks();
  act(() => useNavigationStore.getState().setActivePage('accounts'));
  await tick();
  for (const list of listNames)
    expect(api[list]).toHaveBeenCalledTimes(list === 'listWorkBuddyAccounts' ? 2 : 1);
  expect(api.listWorkBuddyAccounts).toHaveBeenCalledWith('workbuddy');
  expect(api.listWorkBuddyAccounts).toHaveBeenCalledWith('workbuddyai');
  for (const name of ['start', 'refresh', 'switch', 'delete', 'claim', 'apply'] as const) {
    for (const [key, action] of Object.entries(api))
      if (key.startsWith(name) && vi.isMockFunction(action)) expect(action).not.toHaveBeenCalled();
  }
  expect(api.startTool).not.toHaveBeenCalled();
  expect(folderPicker).not.toHaveBeenCalled();
  expect(state.applyError).toBeNull();
});

it('Account Center: uninstalled clients never load native accounts', async () => {
  await mount('dsh', false);
  act(() => useNavigationStore.getState().setActivePage('accounts'));
  await tick();
  for (const list of listNames) expect(api[list]).not.toHaveBeenCalled();
  expect(state.applyError).toBeNull();
});

it('Account Center: returning after a passive failure preserves both WorkBuddy editions', async () => {
  const cn = { id: 'cn', name: 'CN', active: true, edition: 'workbuddy' };
  const global = { id: 'global', name: 'Global', active: true, edition: 'workbuddyai' };
  vi.mocked(api.listWorkBuddyAccounts).mockImplementation(
    async (edition) => [edition === 'workbuddy' ? cn : global] as never
  );
  await mount('workbuddy');
  act(() =>
    useToolsStore.getState().setDetectedTools(
      ['workbuddy', 'workbuddyai'].map((id) => ({
        id,
        name: id,
        category: 'Desktop',
        installed: true,
      }))
    )
  );
  act(() => useNavigationStore.getState().setActivePage('accounts'));
  await tick();
  act(() => useNavigationStore.getState().setActivePage('models'));
  await tick();
  vi.mocked(api.listWorkBuddyAccounts).mockRejectedValue(new Error('accountError.read'));
  act(() => useNavigationStore.getState().setActivePage('accounts'));
  await tick();
  expect(state.workBuddyAccountGroups.workbuddy.accounts).toEqual([cn]);
  expect(state.workBuddyAccountGroups.workbuddyai.accounts).toEqual([global]);
  expect(state.applyError).toBeNull();
  vi.mocked(api.listWorkBuddyAccounts).mockResolvedValue([]);
});

it('Account Center: entering cancels App Manager login even when the group stays enabled', async () => {
  vi.mocked(api.startClaudeCodeLogin).mockResolvedValue({
    loginId: 'apps-login',
    authorizationUrl: 'https://example.test',
    expiresAt: Date.now() / 1000 + 60,
  });
  await mount('claudecode');
  await act(async () => {
    await state.claudeCodeAccounts.add();
  });
  act(() => useNavigationStore.getState().setActivePage('accounts'));
  await tick();
  expect(api.cancelClaudeCodeLogin).toHaveBeenCalledWith('apps-login');
  expect(state.claudeCodeAccounts.login).toBeNull();
});

it('Account Center: leaving cancels pending login and ignores a late saved account', async () => {
  let resolve!: (account: api.DeepSeekAccount | null) => void;
  vi.mocked(api.startDeepSeekLogin).mockResolvedValue({
    loginId: 'center-login',
    verificationUri: 'https://example.test',
    expiresAt: Date.now() / 1000 + 60,
  });
  vi.mocked(api.pollDeepSeekLogin).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    })
  );
  await mount('dsh');
  act(() => useNavigationStore.getState().setActivePage('accounts'));
  await tick();
  let task!: Promise<void>;
  await act(async () => {
    task = state.deepSeekAccounts.add();
  });
  act(() => useNavigationStore.getState().setActivePage('apps'));
  await tick();
  expect(api.cancelDeepSeekLogin).toHaveBeenCalledWith('center-login');
  await act(async () => {
    resolve({ id: 'late', name: 'late', active: false, balances: null });
    await task;
  });
  expect(state.deepSeekAccounts.accounts).toEqual([]);
  expect(state.applyError).toBeNull();
});

it('Account Center: login saves an account without clearing the desktop API selection or applying it', async () => {
  const model = {
    internalId: 'fixture-model',
    name: 'Fixture',
    baseUrl: 'https://example.test/v1',
    apiKey: 'fixture',
  };
  vi.mocked(api.getModels).mockResolvedValue([model]);
  const account = { id: 'new', name: 'New', active: false, balances: null };
  vi.mocked(api.startDeepSeekLogin).mockResolvedValue({
    loginId: 'center-login',
    verificationUri: 'https://example.test',
    expiresAt: Date.now() / 1000 + 60,
  });
  vi.mocked(api.pollDeepSeekLogin).mockResolvedValue(account);
  await mount('dsh');
  act(() => state.handleSelectModel('dsh', 'fixture-model'));
  act(() => useNavigationStore.getState().setActivePage('accounts'));
  await tick();
  vi.mocked(api.listDeepSeekAccounts).mockResolvedValue([account]);
  await act(async () => {
    renderer.update(
      <AppManagerProvider>
        <Harness center />
      </AppManagerProvider>
    );
  });
  const section = renderer.root.findAll(
    (node) => node.type === 'section' && node.props['aria-label'] === 'DeepSeek Harness'
  )[0];
  await act(async () => {
    section
      .findAll(
        (node) =>
          node.type === 'button' &&
          node.props['aria-label'] === 'agent.addCurrentAccount DeepSeek Harness'
      )[0]
      .props.onClick();
  });
  await tick();
  expect(state.deepSeekAccounts.accounts).toEqual([account]);
  expect(state.toolModelConfig.dsh).toBe('fixture-model');
  expect(api.switchDeepSeekAccount).not.toHaveBeenCalled();
  expect(api.refreshDeepSeekAccountQuota).not.toHaveBeenCalled();
  expect(api.startTool).not.toHaveBeenCalled();
  vi.mocked(api.getModels).mockResolvedValue([]);
});

it('Account Center: ZCode choice is passive, website follows the region and add uses that region', async () => {
  await mount('zcode');
  act(() => useNavigationStore.getState().setActivePage('accounts'));
  await tick();
  await act(async () => {
    renderer.update(
      <AppManagerProvider>
        <Harness center />
      </AppManagerProvider>
    );
  });
  const section = renderer.root.findAll(
    (node) => node.type === 'section' && node.props['aria-label'] === 'ZCode'
  )[0];
  const choice = section.findAll(
    (node) => node.type === 'button' && node.props['aria-label'] === 'agent.zcodeSwitchProvider'
  )[0];
  const website = section.findAll(
    (node) => node.type === 'button' && node.props['aria-label'] === 'accountCenter.website'
  )[0];
  expect(
    section.findAll((node) => node.type === 'span' && node.children.includes('bigmodel.cn'))
  ).toHaveLength(1);
  await act(async () => website.props.onClick());
  expect(api.openExternal).toHaveBeenCalledWith('https://bigmodel.cn/glm-coding');
  expect(api.startZCodeLogin).not.toHaveBeenCalled();
  vi.mocked(api.openExternal).mockClear();
  act(() => choice.props.onClick());
  expect(state.zcodeAccounts.provider).toBe('zai');
  expect(api.startZCodeLogin).not.toHaveBeenCalled();
  expect(api.openExternal).not.toHaveBeenCalled();
  expect(
    section.findAll((node) => node.type === 'span' && node.children.includes('z.ai'))
  ).toHaveLength(1);
  await act(async () => website.props.onClick());
  expect(api.openExternal).toHaveBeenCalledWith('https://z.ai/subscribe');
  expect(api.startZCodeLogin).not.toHaveBeenCalled();
  expect(api.refreshZCodeAccountQuota).not.toHaveBeenCalled();
  expect(api.switchZCodeAccount).not.toHaveBeenCalled();
  expect(api.startTool).not.toHaveBeenCalled();
  vi.mocked(api.openExternal).mockClear();
  act(() => choice.props.onClick());
  expect(state.zcodeAccounts.provider).toBe('bigmodel');
  expect(
    section.findAll((node) => node.type === 'span' && node.children.includes('bigmodel.cn'))
  ).toHaveLength(1);
  expect(api.openExternal).not.toHaveBeenCalled();
  act(() => choice.props.onClick());
  vi.mocked(api.startZCodeLogin).mockResolvedValue(zcodeLogin());
  vi.mocked(api.pollZCodeLogin).mockResolvedValue(zcodeRow);
  await act(async () => {
    section
      .findAll(
        (node) =>
          node.type === 'button' && node.props['aria-label'] === 'agent.addCurrentAccount ZCode'
      )[0]
      .props.onClick();
  });
  await tick();
  expect(api.startZCodeLogin).toHaveBeenCalledWith('zai');
  expect(api.refreshZCodeAccountQuota).not.toHaveBeenCalled();
  expect(api.switchZCodeAccount).not.toHaveBeenCalled();
});

it('Account Center: website and refresh actions are separate, and a refresh failure remains visible', async () => {
  const row = { id: 'saved', name: 'Saved', active: false, balances: null };
  vi.mocked(api.listDeepSeekAccounts).mockResolvedValue([row]);
  vi.mocked(api.openExternal).mockResolvedValue(undefined);
  await mount('dsh');
  act(() =>
    useToolsStore.getState().setDetectedTools([
      {
        id: 'dsh',
        name: 'DeepSeek Harness',
        category: 'CLI Code',
        installed: true,
        website: 'https://www.deepseek.com/harness/',
      },
    ])
  );
  act(() => useNavigationStore.getState().setActivePage('accounts'));
  await tick();
  await act(async () => {
    renderer.update(
      <AppManagerProvider>
        <Harness center />
      </AppManagerProvider>
    );
  });
  const providerSection = renderer.root.findAll(
    (node) => node.type === 'section' && node.props['aria-label'] === 'DeepSeek Harness'
  )[0];
  const website = providerSection.findAll(
    (node) => node.type === 'button' && node.props['aria-label'] === 'accountCenter.website'
  )[0];
  expect(website.props.disabled).toBe(false);
  await act(async () => {
    await website.props.onClick();
  });
  expect(api.openExternal).toHaveBeenCalledWith('https://www.deepseek.com/harness/');
  expect(api.startDeepSeekLogin).not.toHaveBeenCalled();
  expect(api.refreshDeepSeekAccountQuota).not.toHaveBeenCalled();
  vi.mocked(api.refreshDeepSeekAccountQuota).mockRejectedValueOnce(new Error('accountError.quota'));
  const refresh = renderer.root.findAll(
    (node) => node.type === 'button' && node.props['aria-label'] === 'agent.refreshAccount Saved'
  )[0];
  await act(async () => {
    refresh.props.onClick({ stopPropagation: vi.fn() });
  });
  expect(api.refreshDeepSeekAccountQuota).toHaveBeenCalledWith('saved', 'en');
  expect(state.applyError).toBe('accountError.quota');
  expect(state.deepSeekAccounts.accounts).toEqual([row]);
});

it('Claude Code: leaving tool cancels pending login', async () => {
  vi.mocked(api.startClaudeCodeLogin).mockResolvedValue({
    loginId: 'fixture-login',
    authorizationUrl: 'https://example.test',
    expiresAt: Date.now() / 1000 + 60,
  });
  await mount('claudecode');
  await act(async () => {
    await state.claudeCodeAccounts.add();
  });
  expect(state.claudeCodeAccounts.login?.loginId).toBe('fixture-login');
  expect(shellOpen).toHaveBeenCalledWith('https://example.test');
  act(() => state.setSelectedTool('cursor'));
  await tick();
  expect(api.cancelClaudeCodeLogin).toHaveBeenCalledWith('fixture-login');
  expect(state.claudeCodeAccounts.login).toBeNull();
});
it('ChatGPT: a late login failure must not open a dialog on another tool', async () => {
  let reject!: (e: Error) => void;
  vi.mocked(api.addCodexAccountViaOAuth).mockReturnValueOnce(
    new Promise((_, r) => {
      reject = r;
    })
  );
  await mount('chatgptdesktop');
  let task!: Promise<void>;
  await act(async () => {
    task = state.addCodexAccount();
  });
  act(() => state.setSelectedTool('cursor'));
  await act(async () => {
    reject(new Error('accountError.expired'));
    await task;
  });
  expect(state.applyError).toBeNull();
});
it('Grok Build: account launch must use the common CLI folder picker', async () => {
  vi.mocked(api.listGrokAccounts).mockResolvedValue([
    { id: 'fixture', email: 'fixture@example.test', active: true },
  ] as never);
  await mount('grok');
  expect(state.grokAccounts.selectedId).toBe('fixture');
  await act(async () => {
    await state.handleLaunch();
  });
  expect(folderPicker).toHaveBeenCalledTimes(1);
  expect(api.startTool).toHaveBeenCalledWith('grok', undefined, 'E:/fixture-project');
});
it('positive control: passive Grok navigation does not refresh, switch, or log in', async () => {
  await mount('grok');
  expect(api.listGrokAccounts).toHaveBeenCalledTimes(1);
  expect(api.refreshGrokAccount).not.toHaveBeenCalled();
  expect(api.switchGrokAccount).not.toHaveBeenCalled();
  expect(api.startGrokLogin).not.toHaveBeenCalled();
});
it.each(['workbuddy', 'workbuddyai'] as const)(
  '%s: account selection preserves custom model configuration',
  async (edition) => {
    vi.mocked(api.listWorkBuddyAccounts).mockResolvedValue([
      { id: 'fixture', name: 'fixture', edition, active: true },
    ] as never);
    await mount(edition);
    expect(api.switchWorkBuddyAccount).not.toHaveBeenCalled();
    await act(async () => {
      await state.handleLaunch();
    });
    expect(api.switchWorkBuddyAccount).toHaveBeenCalledExactlyOnceWith(edition, 'fixture');
    expect(api.restoreToolToOfficial).not.toHaveBeenCalled();
  }
);
it.each(['workbuddy', 'workbuddyai'] as const)(
  '%s: failed history/account apply is visible and prevents launch',
  async (edition) => {
    vi.mocked(api.listWorkBuddyAccounts).mockResolvedValue([
      { id: 'fixture', name: 'fixture', edition, active: true },
    ] as never);
    await mount(edition);
    const loaded = vi.mocked(api.listWorkBuddyAccounts).mock.calls.length;
    vi.mocked(api.switchWorkBuddyAccount).mockRejectedValueOnce(
      new Error('accountError.write|WorkBuddy history: database is locked')
    );
    await act(async () => {
      await state.handleLaunch();
    });
    expect(state.applyError).toBe('accountError.write');
    expect(api.startTool).not.toHaveBeenCalled();
    expect(api.listWorkBuddyAccounts).toHaveBeenCalledTimes(loaded);
    expect(api.refreshWorkBuddyAccountQuota).not.toHaveBeenCalled();
    expect(api.restoreToolToOfficial).not.toHaveBeenCalled();
  }
);
const sharedHistoryTools = [
  ['zcode', 'listZCodeAccounts', 'switchZCodeAccount'],
  ['dsh', 'listDeepSeekAccounts', 'switchDeepSeekAccount'],
  ['grok', 'listGrokAccounts', 'switchGrokAccount'],
  ['cursor', 'listCursorAccounts', 'switchCursorAccount'],
  ['antigravity', 'listAntigravityAccounts', 'switchAntigravityAccount'],
  ['antigravitydesktop', 'listAntigravityAccounts', 'switchAntigravityAccount'],
] as const;
it.each(sharedHistoryTools)(
  '%s: explicit account apply completes before reload and native launch',
  async (tool, list, apply) => {
    const row = { id: 'fixture', email: 'fixture@example.test', active: true };
    vi.mocked(api[list]).mockResolvedValue([row] as never);
    await mount(tool);
    act(() => state.setLaunchAfterApply(true));
    const loaded = vi.mocked(api[list]).mock.calls.length;
    let complete!: (result: never) => void;
    vi.mocked(api[apply]).mockReturnValueOnce(
      new Promise((resolve) => {
        complete = resolve;
      }) as never
    );
    let task!: Promise<void>;
    act(() => {
      task = state.handleLaunch();
    });
    await tick();
    expect(api[apply]).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api[apply]).mock.calls[0][0]).toBe('fixture');
    expect(api[list]).toHaveBeenCalledTimes(loaded);
    expect(api.startTool).not.toHaveBeenCalled();
    await act(async () => {
      await state.handleLaunch();
    });
    expect(api[apply]).toHaveBeenCalledTimes(1);
    await act(async () => {
      complete(row as never);
      await task;
    });
    expect(api[list]).toHaveBeenCalledTimes(loaded + 1);
    expect(api.startTool).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.startTool).mock.calls[0][0]).toBe(tool);
    expect(state.applyError).toBeNull();
  }
);
it.each(sharedHistoryTools)(
  '%s: failed account apply preserves cached rows and prevents launch',
  async (tool, list, apply) => {
    const row = { id: 'fixture', email: 'fixture@example.test', active: true };
    vi.mocked(api[list]).mockResolvedValue([row] as never);
    await mount(tool);
    const loaded = vi.mocked(api[list]).mock.calls.length;
    vi.mocked(api[apply]).mockRejectedValueOnce(new Error('accountError.write'));
    await act(async () => {
      await state.handleLaunch();
    });
    expect(api[apply]).toHaveBeenCalledTimes(1);
    expect(state.applyError).toBe('accountError.write');
    expect(api[list]).toHaveBeenCalledTimes(loaded);
    expect(api.startTool).not.toHaveBeenCalled();
    const rows = {
      zcode: state.zcodeAccounts.accounts,
      dsh: state.deepSeekAccounts.accounts,
      grok: state.grokAccounts.accounts,
      cursor: state.cursorAccounts.accounts,
      antigravity: state.antigravityAccounts.accounts,
      antigravitydesktop: state.antigravityAccounts.accounts,
    };
    expect(rows[tool]).toEqual([row]);
    expect(api.refreshZCodeAccountQuota).not.toHaveBeenCalled();
    expect(api.refreshDeepSeekAccountQuota).not.toHaveBeenCalled();
    expect(api.refreshGrokAccount).not.toHaveBeenCalled();
    expect(api.refreshCursorAccount).not.toHaveBeenCalled();
    expect(api.refreshAntigravityAccount).not.toHaveBeenCalled();
  }
);
it('positive control: Grok Build without account selection uses the CLI folder picker', async () => {
  await mount('grok');
  expect(state.grokAccounts.selectedId).toBeNull();
  await act(async () => {
    await state.handleLaunch();
  });
  expect(folderPicker).toHaveBeenCalledTimes(1);
  expect(api.startTool).toHaveBeenCalledWith('grok', undefined, 'E:/fixture-project');
});
it('Claude Code: adding an account must not automatically refresh quota', async () => {
  vi.mocked(api.startClaudeCodeLogin).mockResolvedValue({
    loginId: 'login',
    authorizationUrl: 'https://example.test',
    expiresAt: Date.now() / 1000 + 60,
  });
  vi.mocked(api.completeClaudeCodeLogin).mockResolvedValue({
    id: 'fixture',
    email: 'fixture@example.test',
  } as never);
  await mount('claudecode');
  await act(async () => {
    await state.claudeCodeAccounts.add();
  });
  await act(async () => {
    await state.claudeCodeAccounts.completeLogin('fixture-code');
  });
  expect(api.refreshClaudeCodeAccountQuota).not.toHaveBeenCalled();
});
it('WorkBuddy: adding an account must not automatically refresh quota', async () => {
  vi.mocked(api.startWorkBuddyLogin).mockResolvedValue({
    loginId: 'login',
    verificationUri: 'https://example.test',
    expiresAt: Date.now() / 1000 + 60,
  });
  vi.mocked(api.pollWorkBuddyLogin).mockResolvedValue({
    id: 'fixture',
    edition: 'workbuddy',
  } as never);
  vi.mocked(api.cancelWorkBuddyLogin).mockResolvedValue(undefined);
  await mount('workbuddy');
  await act(async () => {
    await state.workBuddyAccounts.add();
  });
  expect(api.refreshWorkBuddyAccountQuota).not.toHaveBeenCalled();
});
it('DeepSeek: adding an account must not automatically refresh quota', async () => {
  vi.mocked(api.startDeepSeekLogin).mockResolvedValue({
    loginId: 'login',
    verificationUri: 'https://example.test',
    expiresAt: Date.now() / 1000 + 60,
  });
  vi.mocked(api.pollDeepSeekLogin).mockResolvedValue({ id: 'fixture' } as never);
  vi.mocked(api.cancelDeepSeekLogin).mockResolvedValue(undefined);
  await mount('dsh');
  await act(async () => {
    await state.deepSeekAccounts.add();
  });
  expect(api.refreshDeepSeekAccountQuota).not.toHaveBeenCalled();
});

const zcodeRow: api.ZCodeAccount = {
  id: 'bigmodel:one',
  provider: 'bigmodel',
  email: 'one@example.test',
  active: true,
  plan: 'Pro',
  remainingPercent: 40,
  resetAt: null,
  subscriptionEndAt: 1900000000,
  quotaWindows: [
    { remainingPercent: 40, resetAt: 1890000000 },
    { remainingPercent: 70, resetAt: 1890200000 },
  ],
};
function zcodeLogin(): api.ZCodeLogin {
  return {
    loginId: 'zcode-login',
    verificationUri: 'https://bigmodel.cn/login',
    expiresAt: Date.now() / 1000 + 60,
    pollIntervalSeconds: 1,
  };
}
it('ZCode: region choice is passive, login saves without refresh or apply, selection excludes API models', async () => {
  await mount('zcode');
  act(() => state.zcodeAccounts.setProvider('zai'));
  expect(api.startZCodeLogin).not.toHaveBeenCalled();
  expect(api.listZCodeAccounts).toHaveBeenCalledTimes(1);
  act(() => state.handleSelectModel('zcode', 'api-model'));
  vi.mocked(api.startZCodeLogin).mockResolvedValue(zcodeLogin());
  vi.mocked(api.pollZCodeLogin).mockResolvedValue(zcodeRow);
  vi.mocked(api.cancelZCodeLogin).mockResolvedValue(undefined);
  vi.mocked(api.listZCodeAccounts).mockResolvedValue([zcodeRow]);
  await act(async () => {
    await state.zcodeAccounts.add();
  });
  expect(api.startZCodeLogin).toHaveBeenCalledWith('zai');
  expect(api.openExternal).toHaveBeenCalledWith('https://bigmodel.cn/login');
  expect(state.zcodeAccounts.selectedId).toBe(zcodeRow.id);
  expect(state.toolModelConfig.zcode).toBeNull();
  expect(api.switchZCodeAccount).not.toHaveBeenCalled();
  expect(api.refreshZCodeAccountQuota).not.toHaveBeenCalled();
  act(() => state.handleSelectModel('zcode', 'api-model'));
  expect(state.zcodeAccounts.selectedId).toBeNull();
  act(() => state.zcodeAccounts.select(zcodeRow.id));
  expect(state.toolModelConfig.zcode).toBeNull();
});
it.each(['page', 'tool', 'timeout'] as const)(
  'ZCode: %s cancels login and ignores a late result',
  async (exit) => {
    let finish!: (row: api.ZCodeAccount) => void;
    vi.mocked(api.startZCodeLogin).mockResolvedValue(zcodeLogin());
    vi.mocked(api.pollZCodeLogin).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    vi.mocked(api.cancelZCodeLogin).mockResolvedValue(undefined);
    await mount('zcode');
    let task!: Promise<void>;
    await act(async () => {
      task = state.zcodeAccounts.add();
    });
    act(() => state.zcodeAccounts.setProvider('zai'));
    expect(state.zcodeAccounts.provider).toBe('bigmodel');
    if (exit === 'timeout') {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(state.applyError).toBe('accountError.expired');
    } else {
      act(() =>
        exit === 'page'
          ? useNavigationStore.getState().setActivePage('models')
          : state.setSelectedTool(null)
      );
      await tick();
    }
    expect(api.cancelZCodeLogin).toHaveBeenCalledWith('zcode-login');
    await act(async () => {
      finish(zcodeRow);
      await task;
    });
    expect(state.zcodeAccounts.accounts).toEqual([]);
    expect(api.listZCodeAccounts).toHaveBeenCalledTimes(1);
    expect(api.switchZCodeAccount).not.toHaveBeenCalled();
  }
);
it('ZCode: passive reload preserves cached rows and apply failure does not launch', async () => {
  vi.mocked(api.listZCodeAccounts).mockResolvedValue([zcodeRow]);
  await mount('zcode');
  act(() => useNavigationStore.getState().setActivePage('models'));
  await tick();
  vi.mocked(api.listZCodeAccounts).mockRejectedValueOnce(new Error('accountError.read'));
  act(() => useNavigationStore.getState().setActivePage('apps'));
  await tick();
  expect(state.zcodeAccounts.accounts).toEqual([zcodeRow]);
  expect(state.applyError).toBeNull();
  act(() => {
    state.zcodeAccounts.select(zcodeRow.id);
    state.setLaunchAfterApply(true);
  });
  vi.mocked(api.switchZCodeAccount).mockRejectedValueOnce(new Error('accountError.write'));
  await act(async () => {
    await state.handleLaunch();
  });
  expect(state.applyError).toBe('accountError.write');
  expect(api.startTool).not.toHaveBeenCalled();
  vi.mocked(api.switchZCodeAccount).mockResolvedValue(zcodeRow);
  await act(async () => {
    await state.handleLaunch();
  });
  expect(api.switchZCodeAccount).toHaveBeenCalledWith(zcodeRow.id);
  expect(api.startTool).toHaveBeenCalledWith('zcode', undefined);
  expect(api.refreshZCodeAccountQuota).not.toHaveBeenCalled();
});
it('ZCode: explicit quota failure remains visible and cached, delete uses the shared confirmation flow', async () => {
  vi.mocked(api.listZCodeAccounts).mockResolvedValue([zcodeRow]);
  await mount('zcode');
  vi.mocked(api.refreshZCodeAccountQuota).mockRejectedValueOnce(new Error('accountError.network'));
  await act(async () => {
    await state.zcodeAccounts.refresh(zcodeRow);
  });
  expect(state.applyError).toBe('accountError.network');
  expect(state.zcodeAccounts.accounts).toEqual([zcodeRow]);
  let finish!: (row: api.ZCodeAccount) => void;
  vi.mocked(api.refreshZCodeAccountQuota).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  let refresh!: Promise<void>;
  await act(async () => {
    refresh = state.zcodeAccounts.refresh(zcodeRow);
  });
  expect(state.zcodeAccounts.refreshing.has(zcodeRow.id)).toBe(true);
  const updated = { ...zcodeRow, plan: 'Max', subscriptionEndAt: 1910000000 };
  await act(async () => {
    finish(updated);
    await refresh;
  });
  expect(state.zcodeAccounts.refreshing.size).toBe(0);
  expect(state.zcodeAccounts.accounts).toEqual([updated]);
  expect(api.startZCodeLogin).not.toHaveBeenCalled();
  expect(api.switchZCodeAccount).not.toHaveBeenCalled();
  vi.mocked(api.deleteZCodeAccount).mockResolvedValue(undefined);
  await act(async () => {
    await state.zcodeAccounts.remove(zcodeRow);
  });
  expect(api.deleteZCodeAccount).toHaveBeenCalledWith(zcodeRow.id);
  expect(state.zcodeAccounts.accounts).toEqual([]);
  expect(state.zcodeAccounts.selectedId).toBeNull();
});
