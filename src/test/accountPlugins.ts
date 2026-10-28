import type { InstalledPlugin } from '../api/plugins';
import { usePluginsStore } from '../stores/pluginsStore';
import { useNavigationStore } from '../stores/navigationStore';

export function installedAccountPlugins(): InstalledPlugin[] {
  return [
    'claudecode',
    'claudedesktop',
    'workbuddy',
    'workbuddyai',
    'doubaowork',
    'dola',
    'trae',
    'traecn',
  ].map((application) => ({
    id: `fixture.${application}`,
    enabled: true,
    directory: `/fixture/${application}`,
    source: 'local',
    revision: null,
    icon: null,
    manifest: {
      name: application,
      publisher: 'fixture',
      version: '0.1.0',
      displayName: application,
      description: 'Account fixture',
      license: 'MIT',
      repository: 'https://example.com/plugins',
      category: 'account',
      echobird: {
        manifestVersion: 1,
        apiVersion: '0.1-draft',
        platforms: ['windows', 'macos', 'linux'],
        permissions: ['account.code'],
        worker: { runtime: 'native', entry: 'bin/account-engine' },
        contributes: {
          pages: [],
          providers: [
            {
              id: application,
              title: application,
              applications: [application],
              operations: ['accounts', 'login.start'],
            },
          ],
        },
      },
    },
  }));
}

export function enableAccountPlugins() {
  useNavigationStore.setState({ developerMode: true });
  usePluginsStore.setState({
    installed: installedAccountPlugins(),
    loaded: true,
    load: async () => {},
  });
}
