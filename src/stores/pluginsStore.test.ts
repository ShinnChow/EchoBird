import { beforeEach, expect, it, vi } from 'vitest';
import * as api from '../api/plugins';
import type { InstalledPlugin } from '../api/plugins';
import { pluginTools, usePluginsStore as store } from './pluginsStore';
import { useNavigationStore } from './navigationStore';

vi.mock('../api/plugins', () => ({
  listPlugins: vi.fn(),
  getPluginRegistry: vi.fn(),
  installPlugin: vi.fn(),
  setPluginEnabled: vi.fn(),
  uninstallPlugin: vi.fn(),
}));

const plugin: InstalledPlugin = {
  id: 'fixture.game',
  enabled: true,
  directory: 'packages/fixture.game/version',
  source: '/fixture',
  revision: null,
  icon: null,
  manifest: {
    name: 'game',
    publisher: 'fixture',
    version: '1.0.0',
    displayName: 'Game',
    description: 'Fixture',
    license: 'MIT',
    repository: 'https://example.com/fixture',
    echobird: {
      manifestVersion: 1,
      apiVersion: '0.1-draft',
      platforms: ['windows', 'macos', 'linux'],
      permissions: ['model.request'],
      contributes: { pages: [{ id: 'game', title: 'Game', entry: 'ui/index.html' }] },
    },
  },
};

beforeEach(() => {
  useNavigationStore.getState().setDeveloperMode(true);
  store.setState(store.getInitialState(), true);
  vi.clearAllMocks();
});

it('starts no plugin operation while developer preview is paused', async () => {
  useNavigationStore.getState().setDeveloperMode(false);
  await store.getState().load();
  await store.getState().refresh();
  await store.getState().install('stale');
  await store.getState().enable('fixture.game', true);
  await store.getState().uninstall('fixture.game');
  for (const call of Object.values(api)) expect(call).not.toHaveBeenCalled();
});

it.each([
  ['zh-Hans', 'china'],
  ['zh-CN', 'china'],
  ['zh-Hant', 'international'],
  ['zh-TW', 'international'],
  ['en', 'international'],
  ['ja', 'international'],
])('defaults the plugin source from interface locale %s', (locale, region) => {
  store.setState({ regionChosen: false });
  store.getState().syncRegion(locale);
  expect(store.getState().region).toBe(region);
  expect(api.getPluginRegistry).not.toHaveBeenCalled();
});

it('retains a manual source choice across interface language changes', () => {
  const setItem = vi.fn();
  vi.stubGlobal('localStorage', { setItem });
  try {
    store.getState().syncRegion('zh-Hans');
    store.getState().setRegion('international');
    store.getState().syncRegion('zh-Hans');
    expect(store.getState().region).toBe('international');
    expect(setItem).toHaveBeenCalledWith('echobird_plugin_region', 'international');
  } finally {
    vi.unstubAllGlobals();
  }
});

it('does not let old loads clear pending state or restore rows after pause and resume', async () => {
  let finishOld!: (value: InstalledPlugin[]) => void;
  let finishNew!: (value: InstalledPlugin[]) => void;
  vi.mocked(api.listPlugins).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishOld = resolve;
      })
  );
  const old = store.getState().load();
  useNavigationStore.getState().setDeveloperMode(false);
  useNavigationStore.getState().setDeveloperMode(true);
  vi.mocked(api.listPlugins).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishNew = resolve;
      })
  );
  const current = store.getState().load();
  finishOld([plugin]);
  await old;
  expect(store.getState().installed).toEqual([]);
  expect(store.getState().loading).toBe(true);
  finishNew([plugin]);
  await current;
  expect(store.getState().installed).toEqual([plugin]);
  expect(store.getState().loading).toBe(false);
});

it('does not apply a late mutation from a previous activation', async () => {
  let finish!: (value: InstalledPlugin[]) => void;
  vi.mocked(api.installPlugin).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const pending = store.getState().install('candidate');
  useNavigationStore.getState().setDeveloperMode(false);
  useNavigationStore.getState().setDeveloperMode(true);
  finish([plugin]);
  await pending;
  expect(store.getState().installed).toEqual([]);
  expect(store.getState().busy).toBe(false);
});

it('only enabled, installed pages become desktop tools without overwriting built-in identities', () => {
  expect(pluginTools([{ ...plugin, enabled: false }])).toEqual([]);
  expect(pluginTools([plugin])).toEqual([
    expect.objectContaining({
      id: 'plugin:fixture.game:game',
      plugin: { id: 'fixture.game', pageId: 'game' },
      installed: true,
      noModelConfig: false,
    }),
  ]);
  const noPermission = structuredClone(plugin);
  noPermission.manifest.echobird.permissions = [];
  expect(pluginTools([noPermission])[0].noModelConfig).toBe(true);
});

it('passive loading reads installed metadata without fetching the Hub or changing enablement', async () => {
  vi.mocked(api.listPlugins).mockResolvedValue([plugin]);
  await store.getState().load();
  expect(store.getState().installed).toEqual([plugin]);
  expect(api.getPluginRegistry).not.toHaveBeenCalled();
  expect(api.setPluginEnabled).not.toHaveBeenCalled();
  expect(api.installPlugin).not.toHaveBeenCalled();
});

it('failed loading preserves cached entries and explicit failures do not invent success', async () => {
  store.setState({ installed: [plugin] });
  vi.mocked(api.listPlugins).mockRejectedValue(new Error('unavailable'));
  await store.getState().load();
  expect(store.getState().installed).toEqual([plugin]);
  vi.mocked(api.setPluginEnabled).mockRejectedValue(new Error('save failed'));
  await expect(store.getState().enable(plugin.id, false)).rejects.toThrow('save failed');
  expect(store.getState().installed[0].enabled).toBe(true);
});

it('a late passive result cannot restore an uninstalled plugin', async () => {
  let finish!: (plugins: InstalledPlugin[]) => void;
  vi.mocked(api.listPlugins).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  vi.mocked(api.uninstallPlugin).mockResolvedValue([]);
  const loading = store.getState().load();
  await store.getState().uninstall(plugin.id);
  finish([plugin]);
  await loading;
  expect(store.getState().installed).toEqual([]);
});

it('only explicit refresh fetches the selected regional index and keeps the prior index on failure', async () => {
  store.setState({ region: 'china' });
  vi.mocked(api.listPlugins).mockResolvedValue([plugin]);
  vi.mocked(api.getPluginRegistry).mockRejectedValue(new Error('offline'));
  const previous = store.getState().registry;
  await store.getState().refresh();
  expect(api.getPluginRegistry).toHaveBeenCalledExactlyOnceWith('china', true);
  expect(store.getState().registry).toBe(previous);
  expect(store.getState().error).toContain('offline');
});
