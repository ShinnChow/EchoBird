import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useNavigationStore } from '../../stores/navigationStore';

const api = vi.hoisted(() => ({
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
}));
vi.mock('../../api/tauri', () => api);

import { openAccountPlugins } from './openAccountPlugins';

beforeEach(() => {
  useNavigationStore.setState(useNavigationStore.getInitialState(), true);
  vi.clearAllMocks();
});

describe('openAccountPlugins', () => {
  it('enables the existing preview setting without losing other settings and opens the complete marketplace', async () => {
    api.getSettings.mockResolvedValue({
      developerMode: false,
      locale: 'zh-Hans',
      themeMode: 'dark',
      closeToTray: true,
    });
    api.saveSettings.mockResolvedValue(undefined);

    await openAccountPlugins();

    expect(api.saveSettings).toHaveBeenCalledWith({
      developerMode: true,
      locale: 'zh-Hans',
      themeMode: 'dark',
      closeToTray: true,
    });
    expect(useNavigationStore.getState()).toMatchObject({
      developerMode: true,
      activePage: 'developer',
      developerTab: 'plugins',
      accountPluginsRequest: expect.any(Number),
    });
  });

  it('keeps the current settings and routes directly when preview mode is already enabled', async () => {
    useNavigationStore.getState().setDeveloperMode(true);

    await openAccountPlugins();

    expect(api.getSettings).not.toHaveBeenCalled();
    expect(api.saveSettings).not.toHaveBeenCalled();
    expect(useNavigationStore.getState()).toMatchObject({
      activePage: 'developer',
      developerTab: 'plugins',
      accountPluginsRequest: expect.any(Number),
    });
  });

  it('does not navigate when enabling preview persistence fails', async () => {
    api.getSettings.mockResolvedValue({ developerMode: false, locale: 'en' });
    api.saveSettings.mockRejectedValue(new Error('Settings are read-only'));

    await expect(openAccountPlugins()).rejects.toThrow('Settings are read-only');
    expect(useNavigationStore.getState().activePage).toBe('apps');
    expect(useNavigationStore.getState().developerMode).toBe(false);
  });
});
