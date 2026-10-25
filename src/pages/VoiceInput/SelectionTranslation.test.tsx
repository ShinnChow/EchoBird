import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { listen } from '@tauri-apps/api/event';
import { readText } from '@tauri-apps/plugin-clipboard-manager';
import * as api from '../../api/voiceInput';
import { copyText } from '../../utils/copyText';
import { SelectionTranslation } from './SelectionTranslation';

vi.mock('../../api/voiceInput', async (original) => ({
  ...(await original<typeof import('../../api/voiceInput')>()),
  getSelectionTranslation: vi.fn(),
  readySelectionTranslation: vi.fn().mockResolvedValue({}),
  openSelectionTranslation: vi.fn().mockResolvedValue(undefined),
  askSelection: vi.fn().mockResolvedValue(undefined),
  translateSelection: vi.fn().mockResolvedValue(undefined),
  closeSelectionTranslation: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({ readText: vi.fn() }));
vi.mock('../../utils/copyText', () => ({ copyText: vi.fn() }));
vi.mock('../../hooks/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('../../stores/themeStore', () => ({
  THEME_CHANGED_EVENT: 'theme',
  useThemeStore: { getState: () => ({ sync: vi.fn() }) },
}));

let renderer: ReactTestRenderer;
const listeners = new Map<string, (event: { payload: unknown }) => void>();
const keys = new Map<string, (event: { key: string }) => void>();
const initial = (): api.SelectionTranslation => ({
  source: 'Hello world',
  text: '你好，世界',
  language: 'zh-Hans',
  busy: false,
  error: null,
  revision: 1,
});
beforeEach(() => {
  vi.clearAllMocks();
  listeners.clear();
  keys.clear();
  vi.mocked(listen).mockImplementation(async (event, callback) => {
    listeners.set(String(event), callback as (event: { payload: unknown }) => void);
    return () => {
      listeners.delete(String(event));
    };
  });
  vi.mocked(api.getSelectionTranslation).mockResolvedValue(initial());
  vi.stubGlobal('window', {
    addEventListener: (event: string, callback: (event: { key: string }) => void) =>
      keys.set(event, callback),
    removeEventListener: (event: string) => keys.delete(event),
  });
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => {
    callback();
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});
afterEach(() => {
  act(() => renderer?.unmount());
  vi.unstubAllGlobals();
});
const mount = () =>
  act(async () => {
    renderer = create(<SelectionTranslation />);
  });
const button = (label: string) =>
  renderer.root
    .findAllByType('button')
    .find((node) => node.props['aria-label'] === label || node.children.includes(label))!;

it('loads only its saved state without translating or reading/copying the clipboard', async () => {
  await mount();
  expect(api.getSelectionTranslation).toHaveBeenCalledOnce();
  expect(api.readySelectionTranslation).toHaveBeenCalledOnce();
  expect(api.translateSelection).not.toHaveBeenCalled();
  expect(readText).not.toHaveBeenCalled();
  expect(copyText).not.toHaveBeenCalled();
  expect(JSON.stringify(renderer.toJSON())).toContain('你好，世界');
});
it('opens the selection toolbar without copying or translating until Translate is clicked', async () => {
  vi.mocked(api.getSelectionTranslation).mockResolvedValue({
    ...initial(),
    mode: 'toolbar',
    source: '',
    text: '',
  });
  await mount();
  expect(renderer.root.findByProps({ role: 'toolbar' })).toBeDefined();
  expect(button('voice.selectionAsk').props.disabled).toBe(false);
  expect(api.openSelectionTranslation).not.toHaveBeenCalled();
  expect(api.translateSelection).not.toHaveBeenCalled();
  expect(readText).not.toHaveBeenCalled();
  await act(async () => button('voice.selectionAction').props.onClick());
  expect(api.openSelectionTranslation).toHaveBeenCalledOnce();
  expect(api.translateSelection).not.toHaveBeenCalled();
});
it('asks only after a click without starting translation or reading the clipboard in the webview', async () => {
  vi.mocked(api.getSelectionTranslation).mockResolvedValue({
    ...initial(),
    mode: 'toolbar',
    source: '',
    text: '',
  });
  await mount();
  expect(api.askSelection).not.toHaveBeenCalled();
  await act(async () => button('voice.selectionAsk').props.onClick());
  expect(api.askSelection).toHaveBeenCalledOnce();
  expect(api.openSelectionTranslation).not.toHaveBeenCalled();
  expect(api.translateSelection).not.toHaveBeenCalled();
  expect(readText).not.toHaveBeenCalled();
});

it('keeps manual paste empty without reporting a failed automatic capture', async () => {
  vi.mocked(api.getSelectionTranslation).mockResolvedValue({
    ...initial(),
    mode: 'manual',
    source: '',
    text: '',
  });
  await mount();
  expect(renderer.root.findAllByProps({ role: 'alert' })).toHaveLength(0);
  expect(button('voice.selectionPaste').props.disabled).toBe(false);
  expect(readText).not.toHaveBeenCalled();
});
it('clears the toolbar on dismissal and rejects an older source event', async () => {
  vi.mocked(api.getSelectionTranslation).mockResolvedValue({ ...initial(), mode: 'toolbar' });
  await mount();
  act(() =>
    listeners.get('voice-selection-state')!({
      payload: {
        ...initial(),
        mode: 'closed',
        source: '',
        text: '',
        language: '',
        revision: 3,
      },
    })
  );
  expect(renderer.toJSON()).toBeNull();
  act(() =>
    listeners.get('voice-selection-state')!({
      payload: {
        ...initial(),
        mode: 'toolbar',
        revision: 2,
      },
    })
  );
  expect(renderer.toJSON()).toBeNull();
  expect(api.openSelectionTranslation).not.toHaveBeenCalled();
});
it('shows the original heading without a language picker and retries with the configured target', async () => {
  vi.mocked(api.getSelectionTranslation).mockResolvedValue({ ...initial(), language: 'en' });
  await mount();
  expect(JSON.stringify(renderer.toJSON())).toContain('voice.selectionSource');
  expect(renderer.root.findAllByType('select')).toHaveLength(0);
  expect(api.translateSelection).not.toHaveBeenCalled();
  await act(async () => button('voice.selectionRetry').props.onClick());
  expect(api.translateSelection).toHaveBeenCalledExactlyOnceWith('Hello world', 'en');
});
it('reads clipboard text only after explicit Paste and translate', async () => {
  vi.mocked(api.getSelectionTranslation).mockResolvedValue({ ...initial(), source: '', text: '' });
  vi.mocked(readText).mockResolvedValue('Copied\ntext🙂');
  await mount();
  expect(readText).not.toHaveBeenCalled();
  await act(async () => button('voice.selectionPaste').props.onClick());
  expect(readText).toHaveBeenCalledOnce();
  expect(api.translateSelection).toHaveBeenCalledWith('Copied\ntext🙂', 'zh-Hans');
});
it('shows an explicit error when the native selection is unavailable instead of an empty result', async () => {
  vi.mocked(api.getSelectionTranslation).mockResolvedValue({ ...initial(), source: '', text: '' });
  await mount();
  expect(renderer.root.findByProps({ role: 'alert' }).children).toContain('voice.selectionEmpty');
  expect(button('voice.selectionPaste').props.disabled).toBe(false);
  expect(api.translateSelection).not.toHaveBeenCalled();
  expect(readText).not.toHaveBeenCalled();
});
it('copies only the translation and closes from the close button or Escape', async () => {
  vi.mocked(copyText).mockResolvedValue(true);
  await mount();
  await act(async () => button('voice.copy').props.onClick());
  expect(copyText).toHaveBeenCalledWith('你好，世界');
  act(() => button('voice.selectionClose').props.onClick());
  act(() => keys.get('keydown')?.({ key: 'Escape' }));
  expect(api.closeSelectionTranslation).toHaveBeenCalledTimes(2);
});
it('does not translate clipboard reads that finish after the card closes', async () => {
  vi.mocked(api.getSelectionTranslation).mockResolvedValue({ ...initial(), source: '', text: '' });
  let finish!: (text: string) => void;
  vi.mocked(readText).mockImplementation(() => new Promise((resolve) => (finish = resolve)));
  await mount();
  act(() => button('voice.selectionPaste').props.onClick());
  act(() =>
    listeners.get('voice-selection-state')?.({
      payload: { ...initial(), revision: 3, source: '', text: '', language: '' },
    })
  );
  await act(async () => finish('late clipboard text'));
  expect(api.translateSelection).not.toHaveBeenCalled();
});
it('ignores late snapshots after closing and preserves the source on translation failure', async () => {
  await mount();
  act(() =>
    listeners.get('voice-selection-state')?.({
      payload: { ...initial(), revision: 3, text: '', error: 'voice.selectionFailed' },
    })
  );
  expect(JSON.stringify(renderer.toJSON())).toContain('Hello world');
  expect(JSON.stringify(renderer.toJSON())).toContain('voice.selectionFailed');
  act(() =>
    listeners.get('voice-selection-state')?.({
      payload: { ...initial(), revision: 2, text: 'stale' },
    })
  );
  expect(JSON.stringify(renderer.toJSON())).not.toContain('stale');
});
