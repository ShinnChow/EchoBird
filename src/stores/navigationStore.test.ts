import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useNavigationStore as navigation } from './navigationStore';

beforeEach(() => navigation.setState(navigation.getInitialState(), true));
afterEach(() => vi.unstubAllGlobals());

it('visits pages in order and moves back and forward without adding duplicate visits', () => {
  const { setActivePage, goBack, goForward } = navigation.getState();
  setActivePage('models');
  setActivePage('voice');
  expect(navigation.getState().backHistory).toEqual(['apps', 'models']);
  goBack();
  expect(navigation.getState()).toMatchObject({
    activePage: 'models',
    backHistory: ['apps'],
    forwardHistory: ['voice'],
  });
  goBack();
  expect(navigation.getState()).toMatchObject({
    activePage: 'apps',
    backHistory: [],
    forwardHistory: ['voice', 'models'],
  });
  goForward();
  goForward();
  expect(navigation.getState()).toMatchObject({
    activePage: 'voice',
    backHistory: ['apps', 'models'],
    forwardHistory: [],
  });
});

it('keeps invalid history actions and repeated current-page clicks inert', () => {
  const changed = vi.fn();
  const stop = navigation.subscribe(changed);
  const { setActivePage, goBack, goForward } = navigation.getState();
  goBack();
  goForward();
  setActivePage('apps');
  expect(changed).not.toHaveBeenCalled();
  setActivePage('models');
  expect(changed).toHaveBeenCalledOnce();
  goBack();
  changed.mockClear();
  setActivePage('apps');
  goBack();
  expect(changed).not.toHaveBeenCalled();
  expect(navigation.getState().forwardHistory).toEqual(['models']);
  stop();
});

it('discards the forward branch when a different page is opened after going back', () => {
  const { setActivePage, goBack, goForward } = navigation.getState();
  setActivePage('models');
  setActivePage('voice');
  goBack();
  setActivePage('accounts');
  expect(navigation.getState()).toMatchObject({
    activePage: 'accounts',
    backHistory: ['apps', 'models'],
    forwardHistory: [],
  });
  goForward();
  expect(navigation.getState().activePage).toBe('accounts');
});

it('records assistant handoffs once and never replays a prefill through history', () => {
  const { setActivePage, goToMother, clearMotherPrefill, goBack, goForward } =
    navigation.getState();
  setActivePage('voice');
  goToMother('Question: \nSelected text: original', 10);
  expect(navigation.getState()).toMatchObject({
    activePage: 'mother',
    backHistory: ['apps', 'voice'],
    motherPrefillCursor: 10,
  });
  clearMotherPrefill();
  goBack();
  goForward();
  expect(navigation.getState()).toMatchObject({
    activePage: 'mother',
    motherPrefill: undefined,
    motherPrefillCursor: undefined,
  });
  goToMother('Another question', 0);
  expect(navigation.getState().backHistory).toEqual(['apps', 'voice']);
  goBack();
  goForward();
  expect(navigation.getState().motherPrefill).toBeUndefined();
});

it('keeps app signals and passive preference operations outside page history', () => {
  const fetch = vi.fn();
  const setItem = vi.fn();
  vi.stubGlobal('fetch', fetch);
  vi.stubGlobal('localStorage', { setItem });
  const {
    setAgentRunning,
    setUpdateAvailable,
    bumpSshServersVersion,
    setActivePage,
    goBack,
    goForward,
  } = navigation.getState();
  setAgentRunning(true);
  setUpdateAvailable('fixture');
  bumpSshServersVersion();
  expect(navigation.getState().backHistory).toEqual([]);
  setActivePage('models');
  goBack();
  goForward();
  expect(navigation.getState()).toMatchObject({
    agentRunning: true,
    updateAvailable: 'fixture',
    sshServersVersion: 1,
  });
  expect(fetch).not.toHaveBeenCalled();
  expect(setItem).not.toHaveBeenCalled();
});
