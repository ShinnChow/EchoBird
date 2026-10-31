import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it } from 'vitest';
import type { InstalledPlugin } from '../api/plugins';
import {
  accountProxySources,
  hasAccountPlugin,
  pluginToolProviders,
  useAccountProviderFilter,
} from './useAccountPlugin';
import { installedAccountPlugins } from '../test/accountPlugins';
import { usePluginsStore } from '../stores/pluginsStore';
import { useNavigationStore } from '../stores/navigationStore';
import { accountProxyProviders } from '../api/accountProxy';

let renderer: ReactTestRenderer;
afterEach(() => {
  act(() => renderer?.unmount());
  usePluginsStore.setState(usePluginsStore.getInitialState(), true);
  useNavigationStore.setState(useNavigationStore.getInitialState(), true);
});

it.each([
  'claudecode',
  'claudedesktop',
  'workbuddy',
  'workbuddyai',
  'doubaowork',
  'dola',
  'trae',
  'traecn',
])('%s requires an enabled native account module and active developer preview', (application) => {
  const plugins = installedAccountPlugins();
  expect(hasAccountPlugin(application, [], true)).toBe(false);
  expect(hasAccountPlugin(application, plugins, false)).toBe(false);
  expect(hasAccountPlugin(application, plugins, true)).toBe(true);
  expect(
    hasAccountPlugin(
      application,
      plugins.map((plugin) => ({ ...plugin, enabled: false })),
      true
    )
  ).toBe(false);
  expect(
    hasAccountPlugin(
      application,
      plugins.map((plugin) => ({
        ...plugin,
        manifest: {
          ...plugin.manifest,
          echobird: { ...plugin.manifest.echobird, worker: undefined },
        },
      })),
      true
    )
  ).toBe(false);
});

it('reveals only installed account integrations and removes them immediately on disable or pause', () => {
  let visible: string[] = [];
  function Harness() {
    const available = useAccountProviderFilter();
    visible = accountProxyProviders.filter(available).map((provider) => provider.id);
    return null;
  }
  useNavigationStore.setState({ developerMode: true });
  usePluginsStore.setState({ installed: [] });
  act(() => {
    renderer = create(<Harness />);
  });
  expect(visible).toContain('codex');
  expect(visible).not.toContain('workBuddy');
  expect(visible).not.toContain('dola');
  expect(visible).not.toContain('trae');
  expect(visible).not.toContain('traecn');
  const plugins = installedAccountPlugins().filter((plugin) => plugin.id === 'fixture.workbuddy');
  act(() => usePluginsStore.setState({ installed: plugins }));
  expect(visible).toContain('workBuddy');
  expect(visible).not.toContain('workBuddyAi');
  act(() =>
    usePluginsStore.setState({
      installed: plugins.map((plugin) => ({ ...plugin, enabled: false })),
    })
  );
  expect(visible).not.toContain('workBuddy');
  act(() => usePluginsStore.setState({ installed: plugins }));
  expect(visible).toContain('workBuddy');
  act(() => useNavigationStore.setState({ developerMode: false }));
  expect(visible).not.toContain('workBuddy');
  expect(visible).toContain('codex');
});

it.each(['trae', 'traecn'])('%s appears only for its own installed and enabled module', (id) => {
  let visible: string[] = [];
  function Harness() {
    const available = useAccountProviderFilter();
    visible = accountProxyProviders.filter(available).map((provider) => provider.id);
    return null;
  }
  const plugins = installedAccountPlugins().filter((plugin) => plugin.id === `fixture.${id}`);
  useNavigationStore.setState({ developerMode: true });
  usePluginsStore.setState({ installed: plugins });
  act(() => {
    renderer = create(<Harness />);
  });
  expect(visible).toContain(id);
  expect(visible).not.toContain(id === 'trae' ? 'traecn' : 'trae');
  act(() =>
    usePluginsStore.setState({
      installed: plugins.map((plugin) => ({ ...plugin, enabled: false })),
    })
  );
  expect(visible).not.toContain(id);
});

it('application plugins provide accounts through their service worker', () => {
  const plugin = {
    id: 'fixture.tool',
    enabled: true,
    icon: 'data:image/png;base64,AA==',
    manifest: {
      tools: [{ id: 'fixture-tool', directory: 'tools/fixture' }],
      echobird: {
        worker: { runtime: 'node', entry: 'service.mjs' },
        contributes: {
          pages: [],
          providers: [{ id: 'fixture', title: 'Fixture', applications: ['fixture-tool'] }],
        },
      },
    },
  } as unknown as InstalledPlugin;
  expect(hasAccountPlugin('fixture-tool', [plugin], true)).toBe(true);
  expect(hasAccountPlugin('fixture-tool', [plugin], false)).toBe(false);
  expect(pluginToolProviders([plugin], true)).toEqual([
    expect.objectContaining({ application: 'fixture-tool', providerId: 'fixture' }),
  ]);
  expect(pluginToolProviders([{ ...plugin, enabled: false }], true)).toEqual([]);
  usePluginsStore.setState({
    installed: [
      {
        ...plugin,
        manifest: {
          ...plugin.manifest,
          tools: [
            { id: 'fixture-tool', directory: 'tools/fixture' },
            { id: 'fixture-cli', directory: 'tools/cli' },
          ],
          echobird: {
            ...plugin.manifest.echobird,
            contributes: {
              pages: [],
              providers: [
                {
                  id: 'fixture',
                  title: 'Fixture',
                  applications: ['fixture-tool', 'fixture-cli'],
                },
              ],
            },
          },
        },
      },
    ],
  });
  useNavigationStore.setState({ developerMode: true });
  expect(accountProxySources().filter((source) => source.id.startsWith('plugin:'))).toEqual([
    expect.objectContaining({ id: 'plugin:fixture-tool' }),
  ]);
});
