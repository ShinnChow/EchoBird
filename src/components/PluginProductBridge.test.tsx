import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PluginProductBridge } from './PluginProductBridge';
import { usePluginProductStore } from '../stores/pluginProductStore';
import { useNavigationStore } from '../stores/navigationStore';
import * as api from '../api/plugins';
const events = vi.hoisted(() => ({
  handlers: new Map<string, () => void>(),
  stop: vi.fn(),
  emit: vi.fn().mockResolvedValue(undefined),
  palette: vi.fn(),
}));
vi.mock('@tauri-apps/api/event', () => ({
  emit: events.emit,
  listen: vi.fn(async (name: string, handler: () => void) => {
    events.handlers.set(name, handler);
    return events.stop;
  }),
}));
vi.mock('../stores/themeStore', () => ({
  THEME_CHANGED_EVENT: 'theme-changed',
  THEME_REQUEST_EVENT: 'theme-request',
  useThemeStore: {
    getState: () => ({ mode: 'dark', colorTheme: 'oatgray', setPluginTheme: events.palette }),
  },
}));
vi.mock('../api/plugins', () => ({
  listPlugins: vi.fn().mockResolvedValue([]),
  getPluginProductState: vi.fn(),
  managePluginProduct: vi.fn(),
  executePluginCommand: vi.fn(),
}));
let view: ReactTestRenderer;
beforeEach(() => {
  vi.clearAllMocks();
  events.handlers.clear();
  useNavigationStore.getState().setDeveloperMode(true);
  usePluginProductStore.getState().reset();
  vi.mocked(api.getPluginProductState).mockResolvedValue({
    theme: null,
    palette: null,
    processors: [],
    configuration: {},
    errors: {},
  });
});
afterEach(() => {
  if (view) act(() => view.unmount());
});
it('reconciles enabled contributions and gives newly opened windows the current plugin palette', async () => {
  await act(async () => {
    view = create(<PluginProductBridge />);
  });
  const palette = {
    id: 'ocean',
    title: 'Ocean',
    light: { accent: '#112233' },
    dark: { accent: '#445566' },
  };
  act(() =>
    usePluginProductStore.setState((state) => ({
      snapshot: { ...state.snapshot, palette, theme: { pluginId: 'fixture.theme', id: 'ocean' } },
    }))
  );
  await act(async () => {
    events.handlers.get('theme-request')!();
  });
  expect(events.emit).toHaveBeenLastCalledWith('theme-changed', {
    mode: 'dark',
    colorTheme: 'oatgray',
    pluginTheme: palette,
  });
  expect(events.palette).toHaveBeenLastCalledWith(palette);
  expect(api.executePluginCommand).not.toHaveBeenCalled();
  expect(api.managePluginProduct).not.toHaveBeenCalled();
});
it('clears active effects on pause and sends a default palette to new windows', async () => {
  await act(async () => {
    view = create(<PluginProductBridge />);
  });
  await act(async () => {
    useNavigationStore.getState().setDeveloperMode(false);
  });
  events.handlers.get('theme-request')!();
  expect(events.emit).toHaveBeenLastCalledWith('theme-changed', {
    mode: 'dark',
    colorTheme: 'oatgray',
    pluginTheme: null,
  });
  expect(events.palette).toHaveBeenLastCalledWith(null);
  expect(usePluginProductStore.getState().snapshot.palette).toBeNull();
});
