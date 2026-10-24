import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShortcutRecorder, bindingFromEvent, formatBinding } from './ShortcutRecorder';
import { VoiceStats } from './VoiceStats';
import { suspendVoiceShortcut } from '../../api/voiceInput';

vi.mock('../../hooks/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, locale: 'zh-Hans' }),
}));
vi.mock('../../api/voiceInput', () => ({
  suspendVoiceShortcut: vi.fn().mockResolvedValue(undefined),
}));
let renderer: ReactTestRenderer;
afterEach(() => {
  if (renderer) act(() => renderer.unmount());
  vi.clearAllMocks();
});
const key = (code: string, flags = {}) => ({
  code,
  key: code,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  repeat: false,
  preventDefault: vi.fn(),
  stopPropagation: vi.fn(),
  ...flags,
});

describe('voice shortcuts', () => {
  it('accepts remote keyboard events that omit the physical code', () => {
    expect(bindingFromEvent(key('', { key: 'F8' }))).toEqual({ code: 'F8', modifiers: [] });
    expect(bindingFromEvent(key('', { key: 'V', ctrlKey: true, shiftKey: true }))).toEqual({
      code: 'KeyV',
      modifiers: ['Control', 'Shift'],
    });
    expect(bindingFromEvent(key('', { key: 'Alt', location: 2, altKey: true }))).toEqual({
      code: 'AltRight',
      modifiers: [],
    });
  });

  it('waits for the primary key in a modifier combination and saves once', async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    act(() => {
      renderer = create(
        <ShortcutRecorder
          binding={{ code: 'AltRight', modifiers: [] }}
          active
          disabled={false}
          onSave={onSave}
        />
      );
    });
    act(() => renderer.root.findByType('button').props.onClick());
    expect(renderer.root.findAllByType('input')).toHaveLength(0);
    expect(renderer.root.findByType('button').children).toContain('voice.recordShortcut');
    act(() =>
      renderer.root.findByType('button').props.onKeyDown(key('ControlLeft', { ctrlKey: true }))
    );
    act(() =>
      renderer.root
        .findByType('button')
        .props.onKeyDown(key('AltLeft', { ctrlKey: true, altKey: true }))
    );
    expect(onSave).not.toHaveBeenCalled();
    await act(async () =>
      renderer.root
        .findByType('button')
        .props.onKeyDown(key('Space', { ctrlKey: true, altKey: true }))
    );
    expect(onSave).toHaveBeenCalledExactlyOnceWith({
      code: 'Space',
      modifiers: ['Control', 'Alt'],
    });
    expect(suspendVoiceShortcut).toHaveBeenCalledWith(true);
    expect(suspendVoiceShortcut).toHaveBeenLastCalledWith(false);
  });

  it('records a lone right modifier only after release', async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    act(() => {
      renderer = create(
        <ShortcutRecorder
          binding={{ code: 'F8', modifiers: [] }}
          active
          disabled={false}
          onSave={onSave}
        />
      );
    });
    act(() => renderer.root.findByType('button').props.onClick());
    act(() =>
      renderer.root.findByType('button').props.onKeyDown(key('AltRight', { altKey: true }))
    );
    expect(onSave).not.toHaveBeenCalled();
    await act(async () => renderer.root.findByType('button').props.onKeyUp(key('AltRight')));
    expect(onSave).toHaveBeenCalledExactlyOnceWith({ code: 'AltRight', modifiers: [] });
  });

  it.each(['Escape', 'Tab', 'blur'])(
    'cancels recording a binding on %s without writing a new setting',
    async (exit) => {
      const onSave = vi.fn().mockResolvedValue(true);
      act(() => {
        renderer = create(
          <ShortcutRecorder
            binding={{ code: 'F8', modifiers: [] }}
            active
            disabled={false}
            onSave={onSave}
          />
        );
      });
      act(() => renderer.root.findByType('button').props.onClick());
      await act(async () => {
        const button = renderer.root.findByType('button');
        if (exit === 'blur') await button.props.onBlur();
        else await button.props.onKeyDown(key(exit));
      });
      expect(onSave).not.toHaveBeenCalled();
      expect(renderer.root.findByType('button').children).toContain('F8');
      expect(suspendVoiceShortcut).toHaveBeenLastCalledWith(false);
    }
  );

  it('uses physical codes and platform modifier names', () => {
    expect(bindingFromEvent(key('KeyK', { metaKey: true, altKey: true }))).toEqual({
      code: 'KeyK',
      modifiers: ['Alt', 'Meta'],
    });
    expect(formatBinding({ code: 'Space', modifiers: ['Meta', 'Alt'] }, 'MacIntel')).toBe(
      '⌘ ⌥ Space'
    );
    expect(formatBinding({ code: 'KeyK', modifiers: ['Meta', 'Control'] }, 'Linux x86_64')).toBe(
      'Super + Ctrl + K'
    );
    expect(formatBinding({ code: 'KeyK', modifiers: ['Control', 'Shift'] }, 'Win32')).toBe(
      'Ctrl + Shift + K'
    );
    const sides = { left: '左侧', right: '右侧' };
    expect(formatBinding({ code: 'AltRight', modifiers: [] }, 'Win32', sides)).toBe('右侧 Alt');
    expect(formatBinding({ code: 'AltRight', modifiers: [] }, 'MacIntel', sides)).toBe('右侧 ⌥');
    expect(formatBinding({ code: 'AltRight', modifiers: [] }, 'Linux x86_64', sides)).toBe(
      '右侧 Alt'
    );
    expect(formatBinding({ code: 'ControlLeft', modifiers: [] }, 'Win32', sides)).toBe('左侧 Ctrl');
    expect(formatBinding({ code: 'MetaRight', modifiers: [] }, 'MacIntel')).toBe('Right ⌘');
    expect(formatBinding({ code: 'MetaRight', modifiers: [] }, 'Linux x86_64')).toBe('Right Super');
  });
});

describe('voice statistics', () => {
  function values() {
    return renderer.root.findAllByType('dd').map((node) => node.children[0]);
  }
  it('keeps unavailable time metrics empty for historical counts without duration', () => {
    act(() => {
      renderer = create(
        <VoiceStats days={{ '2026-10-23': 42 }} usage={{ characters: 0, durationMs: 0 }} />
      );
    });
    expect(values()).toEqual(['42', '—', '—', '—']);
    expect(
      renderer.root
        .findAllByType('span')
        .some((node) => node.children.includes('voice.partialTiming'))
    ).toBe(true);
  });
  it('calculates speech rate and estimated saved time from completed recordings', () => {
    act(() => {
      renderer = create(
        <VoiceStats days={{ today: 120 }} usage={{ characters: 120, durationMs: 60000 }} />
      );
    });
    expect(values()).toEqual(['120', '2', '120', '1']);
    expect(
      renderer.root
        .findAllByType('span')
        .some((node) => node.children.includes('voice.partialTiming'))
    ).toBe(false);
  });
  it('does not invent zeros before use or negative saved time for slow speech', () => {
    act(() => {
      renderer = create(<VoiceStats days={{}} usage={{ characters: 0, durationMs: 0 }} />);
    });
    expect(values()).toEqual(['—', '—', '—', '—']);
    act(() =>
      renderer.update(
        <VoiceStats days={{ today: 20 }} usage={{ characters: 20, durationMs: 60000 }} />
      )
    );
    expect(values()).toEqual(['20', '0', '20', '1']);
  });
});
