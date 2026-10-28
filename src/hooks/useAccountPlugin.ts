import { usePluginsStore } from '../stores/pluginsStore';
import { useNavigationStore } from '../stores/navigationStore';
import type { InstalledPlugin } from '../api/plugins';
import { useCallback } from 'react';

export const communityAccountApplications = [
  'claudecode',
  'claudedesktop',
  'workbuddy',
  'workbuddyai',
  'doubaowork',
  'dola',
  'trae',
  'traecn',
];

export function hasAccountPlugin(
  application: string,
  plugins: InstalledPlugin[],
  active: boolean
): boolean {
  return (
    active &&
    plugins.some(
      (plugin) =>
        plugin.enabled &&
        plugin.manifest.echobird.worker?.runtime === 'native' &&
        plugin.manifest.echobird.contributes.providers?.some((provider) =>
          provider.applications.includes(application)
        )
    )
  );
}

export function accountPluginAvailable(application: string): boolean {
  return hasAccountPlugin(
    application,
    usePluginsStore.getState().installed,
    useNavigationStore.getState().developerMode
  );
}

export function useAccountPlugin(application: string): boolean {
  const plugins = usePluginsStore((state) => state.installed);
  const active = useNavigationStore((state) => state.developerMode);
  return hasAccountPlugin(application, plugins, active);
}

export function useAccountProviderFilter() {
  const plugins = usePluginsStore((state) => state.installed);
  const active = useNavigationStore((state) => state.developerMode);
  return useCallback(
    (provider: { id: string }) => {
      const application = (
        {
          claudeCode: 'claudecode',
          workBuddy: 'workbuddy',
          workBuddyAi: 'workbuddyai',
          doubaowork: 'doubaowork',
          dola: 'dola',
          trae: 'trae',
          traecn: 'traecn',
        } as Record<string, string>
      )[provider.id];
      return !application || hasAccountPlugin(application, plugins, active);
    },
    [plugins, active]
  );
}
