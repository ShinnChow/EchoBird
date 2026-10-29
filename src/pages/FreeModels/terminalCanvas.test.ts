import { afterEach, expect, it, vi } from 'vitest';
import { animateTerminal, type TerminalPlayback } from './terminalCanvas';
import type { TerminalSegment } from '../../api/routerTerminal';

afterEach(() => vi.unstubAllGlobals());

it('keeps the same moving rows across protection toggles and group changes', () => {
  const painted: string[] = [];
  let callback: FrameRequestCallback;
  const context = {
    setTransform: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    measureText: (text: string) => ({ width: Array.from(text).length * 8 }),
    fillText: (text: string) => painted.push(text),
  };
  const canvas = {
    getContext: () => context,
    getBoundingClientRect: () => ({ width: 1000, height: 600 }),
  } as unknown as HTMLCanvasElement;
  vi.stubGlobal('window', { devicePixelRatio: 1 });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  );
  vi.stubGlobal('requestAnimationFrame', (next: FrameRequestCallback) => {
    callback = next;
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const pending = {
    current: [
      [
        {
          text: 'DemoPass!2026',
          protectedText: '{{SECRET_0123456789abcdef0123456789abcdef}}',
          kind: 2,
        },
      ],
    ] as TerminalSegment[][],
  };
  const playback: { current: TerminalPlayback } = {
    current: {
      group: 'one',
      generation: 0,
      realtime: true,
      protection: true,
    },
  };
  const stop = animateTerminal(canvas, pending, '【已保护】', 'waiting', playback)!;
  let now = 0;
  const advance = (duration: number) => {
    for (let i = 0; i < duration; i += 50) {
      now += 50;
      painted.length = 0;
      callback(now);
    }
  };
  advance(8200);
  expect(painted).toContain('【已保护】');
  playback.current.protection = false;
  advance(50);
  expect(painted).toContain('DemoPass!2026');
  expect(painted).not.toContain('【已保护】');
  playback.current.protection = true;
  advance(1000);
  expect(painted).toContain('【已保护】');
  playback.current.group = 'two';
  playback.current.generation++;
  pending.current.push([{ text: 'new-group-row', protectedText: null, kind: null }]);
  advance(50);
  expect(painted).toContain('【已保护】');
  expect(context.clearRect).not.toHaveBeenCalled();
  advance(1000);
  expect(painted.join('')).toContain('new-group-row');
  stop();
  expect(context.clearRect).toHaveBeenCalledOnce();
});

it('generates labeled demo input until real input takes over without clearing displayed rows', () => {
  const painted: string[] = [];
  let callback: FrameRequestCallback;
  const ctx = {
    setTransform: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    measureText: (s: string) => ({ width: s.length * 8 }),
    fillText: (s: string) => painted.push(s),
  };
  vi.stubGlobal('window', { devicePixelRatio: 1 });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  );
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    callback = cb;
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const pending = { current: [] as TerminalSegment[][] };
  const playback: { current: TerminalPlayback } = {
    current: {
      group: 'one',
      generation: 0,
      realtime: false,
      protection: false,
    },
  };
  const stop = animateTerminal(
    {
      getContext: () => ctx,
      getBoundingClientRect: () => ({ width: 1000, height: 600 }),
    } as unknown as HTMLCanvasElement,
    pending,
    '【已保护】',
    'waiting',
    playback
  )!;
  let now = 0;
  const advance = (n: number) => {
    for (let i = 0; i < n; i++) {
      now += 50;
      painted.length = 0;
      callback(now);
    }
  };
  advance(80);
  expect(painted.length).toBeGreaterThan(0);
  expect(painted).not.toContain('【已保护】');
  playback.current.realtime = true;
  playback.current.generation++;
  pending.current.push([{ text: 'actual-request-fixture', protectedText: null, kind: null }]);
  advance(35);
  expect(painted.join('')).toContain('actual-request-fixture');
  expect(ctx.clearRect).not.toHaveBeenCalled();
  stop();
});
