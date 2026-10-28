import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PluginProductControls } from './PluginProductControls';
import { usePluginProductStore as store } from '../stores/pluginProductStore';
import { useNavigationStore } from '../stores/navigationStore';
import * as api from '../api/plugins';
import type { InstalledPlugin } from '../api/plugins';
vi.mock('../hooks/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('../api/plugins', () => ({
  getPluginProductState: vi.fn(),
  managePluginProduct: vi.fn(),
  executePluginCommand: vi.fn(),
}));
const plugin: InstalledPlugin = {
  id: 'fixture.tools',
  enabled: true,
  directory: 'packages/fixture.tools/one',
  source: 'directory',
  revision: null,
  icon: null,
  manifest: {
    name: 'tools',
    publisher: 'fixture',
    version: '1.0.0',
    displayName: 'Tools',
    description: 'Fixture',
    license: 'MIT',
    repository: 'https://example.com/plugin',
    echobird: {
      manifestVersion: 1,
      apiVersion: '0.1-draft',
      platforms: ['windows', 'macos', 'linux'],
      permissions: ['commands', 'configuration', 'text.process'],
      contributes: {
        pages: [],
        commands: [{ id: 'format', title: 'Format' }],
        configuration: [{ key: 'prefix', title: 'Prefix', type: 'string', default: '' }],
        textProcessors: [{ id: 'clean', title: 'Clean speech', stage: 'voice.output' }],
        themes: [
          {
            id: 'ocean',
            title: 'Ocean',
            light: { accent: '#112233' },
            dark: { accent: '#445566' },
          },
        ],
      },
    },
  },
};
let view: ReactTestRenderer;
beforeEach(() => {
  vi.resetAllMocks();
  useNavigationStore.getState().setDeveloperMode(true);
  store.getState().reset();
  vi.mocked(api.getPluginProductState).mockResolvedValue({
    theme: null,
    palette: null,
    processors: [],
    configuration: {},
    errors: {},
  });
  vi.mocked(api.managePluginProduct).mockResolvedValue();
  vi.mocked(api.executePluginCommand).mockResolvedValue('formatted');
});
afterEach(() => {
  if (view) act(() => view.unmount());
});
it('opening details loads declarations with text processing off and no command or mutation', async () => {
  await act(async () => {
    view = create(<PluginProductControls plugin={plugin} />);
  });
  expect(api.getPluginProductState).toHaveBeenCalled();
  expect(api.executePluginCommand).not.toHaveBeenCalled();
  expect(api.managePluginProduct).not.toHaveBeenCalled();
  expect(view.root.findByProps({ role: 'switch' }).props['aria-checked']).toBe(false);
});
it('executes a command only after an explicit click and displays its text result', async () => {
  await act(async () => {
    view = create(<PluginProductControls plugin={plugin} />);
  });
  act(() => view.root.findByType('textarea').props.onChange({ target: { value: ' hello ' } }));
  await act(async () => {
    view.root
      .findAllByType('button')
      .find((n) => n.props.children === 'Format')!
      .props.onClick();
  });
  expect(api.executePluginCommand).toHaveBeenCalledWith(plugin.id, 'format', { text: ' hello ' });
  expect(view.root.findByType('pre').props.children).toBe('formatted');
});
it('saves plugin configuration, hook choices and theme choice as explicit independent actions', async () => {
  await act(async () => {
    view = create(<PluginProductControls plugin={plugin} />);
  });
  await act(async () => {
    view.root.findByType('input').props.onBlur({ target: { value: '> ' } });
  });
  expect(api.managePluginProduct).toHaveBeenLastCalledWith(
    plugin.id,
    'configuration',
    'prefix',
    '> '
  );
  await act(async () => {
    view.root.findByProps({ role: 'switch' }).props.onClick();
  });
  expect(api.managePluginProduct).toHaveBeenLastCalledWith(plugin.id, 'processor', 'clean', true);
  await act(async () => {
    view.root
      .findAllByType('button')
      .find((n) => n.props['aria-pressed'] === false)!
      .props.onClick();
  });
  expect(api.managePluginProduct).toHaveBeenLastCalledWith(plugin.id, 'theme', 'ocean', null);
});
it('shows no product controls or calls for a disabled plugin', async () => {
  await act(async () => {
    view = create(<PluginProductControls plugin={{ ...plugin, enabled: false }} />);
  });
  expect(view.toJSON()).toBeNull();
  expect(api.getPluginProductState).not.toHaveBeenCalled();
});
