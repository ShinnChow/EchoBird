import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { VoiceFlow } from './VoiceFlow';
import { voicePalettes } from './voicePalettes';

interface Wave {
  ratio: number;
  drawFrame: ReturnType<typeof vi.fn>;
  colorize: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
}
const engine = vi.hoisted(() => ({
  bars: [] as Wave[],
  trails: [] as { draw: ReturnType<typeof vi.fn>; reset: ReturnType<typeof vi.fn> }[],
}));
vi.mock('./VoiceBarsRenderer', () => ({
  VoiceBarsRenderer: class {
    canvas = {} as HTMLCanvasElement;
    drawFrame = vi.fn();
    colorize = vi.fn();
    dispose = vi.fn();
    constructor(
      _host: HTMLElement,
      public ratio: number
    ) {
      engine.bars.push(this);
    }
  },
}));
vi.mock('./VoiceRecordingTrail', () => ({
  VoiceRecordingTrail: class {
    draw = vi.fn();
    reset = vi.fn();
    constructor() {
      engine.trails.push(this);
    }
  },
}));
let renderer: ReactTestRenderer,
  frames: Map<number, FrameRequestCallback>,
  serial: number,
  now: number;
let visibility: () => void, preference: () => void, resize: () => void;
let media: {
  matches: boolean;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
};
function tick(count = 1) {
  for (let i = 0; i < count; i++) {
    const pending = [...frames.values()];
    frames.clear();
    now += 1000 / 60;
    act(() => pending.forEach((callback) => callback(now)));
  }
}
function mount() {
  act(() => {
    renderer = create(<VoiceFlow level={0} active theme="auto" />, { createNodeMock: () => ({}) });
  });
  tick();
}
beforeEach(() => {
  engine.bars = [];
  engine.trails = [];
  frames = new Map();
  serial = 0;
  now = 0;
  media = {
    matches: false,
    addEventListener: vi.fn((_name, callback) => {
      preference = callback;
    }),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal('window', {
    devicePixelRatio: 1.25,
    matchMedia: () => media,
    addEventListener: vi.fn((_name, callback) => {
      resize = callback;
    }),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal('document', {
    hidden: false,
    documentElement: { dataset: { theme: 'dark' } },
    addEventListener: vi.fn((_name, callback) => {
      visibility = callback;
    }),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal('IntersectionObserver', undefined);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++serial, callback);
    return serial;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
});
afterEach(() => {
  act(() => renderer?.unmount());
  vi.unstubAllGlobals();
});

it('keeps the existing real-volume bars and tints after history transport, including silence', () => {
  mount();
  const wave = engine.bars[0];
  expect(wave.ratio).toBe(1.25);
  expect(engine.trails).toHaveLength(0);
  act(() => renderer.update(<VoiceFlow level={0} active speaking theme="auto" />));
  tick();
  const trail = engine.trails[0];
  expect(trail.draw).toHaveBeenCalledOnce();
  expect(wave.drawFrame.mock.lastCall?.[0]).toMatchObject({ state: 'speaking', level: 0 });
  expect(wave.drawFrame.mock.invocationCallOrder[1]).toBeLessThan(
    trail.draw.mock.invocationCallOrder[0]
  );
  expect(trail.draw.mock.invocationCallOrder[0]).toBeLessThan(
    wave.colorize.mock.invocationCallOrder[1]
  );
  expect(
    renderer.root.findByProps({ className: 'voice-island-flow' }).props['data-recording']
  ).toBe(true);
  act(() => renderer.update(<VoiceFlow level={0.8} active speaking theme="auto" />));
  tick();
  expect(wave.drawFrame.mock.lastCall?.[0].level).toBe(0.8);
  expect(engine.bars).toHaveLength(1);
  act(() => renderer.update(<VoiceFlow level={0} active theme="auto" />));
  tick();
  expect(trail.reset).toHaveBeenCalledOnce();
  expect(trail.draw).toHaveBeenCalledTimes(2);
});

it.each(voicePalettes)(
  'changes to %s in place without rebuilding the bars or resetting recording history',
  (palette) => {
    mount();
    act(() => renderer.update(<VoiceFlow level={0.5} active speaking theme="auto" />));
    tick();
    const wave = engine.bars[0],
      trail = engine.trails[0];
    act(() =>
      renderer.update(<VoiceFlow level={0.5} active speaking palette={palette} theme="auto" />)
    );
    tick();
    expect(engine.bars).toHaveLength(1);
    expect(engine.trails).toHaveLength(1);
    expect(wave.colorize).toHaveBeenLastCalledWith(palette, false);
    expect(trail.reset).not.toHaveBeenCalled();
    expect(trail.draw).toHaveBeenCalledTimes(2);
  }
);

it('updates theme in place and only recreates the native canvas when DPR changes', () => {
  mount();
  const wave = engine.bars[0];
  act(() => renderer.update(<VoiceFlow level={0} active palette="aurora" theme="light" />));
  tick();
  expect(wave.colorize).toHaveBeenLastCalledWith('aurora', true);
  expect(engine.bars).toHaveLength(1);
  window.devicePixelRatio = 2;
  resize();
  tick();
  expect(engine.bars).toHaveLength(2);
  expect(wave.dispose).toHaveBeenCalledOnce();
  expect(engine.bars[1].ratio).toBe(2);
});

it('stops scrolling for reduced motion but still applies changed palette and live input', () => {
  mount();
  act(() => renderer.update(<VoiceFlow level={0} active speaking theme="auto" />));
  tick();
  const trail = engine.trails[0];
  media.matches = true;
  preference();
  tick();
  expect(trail.reset).toHaveBeenCalledOnce();
  expect(trail.draw).toHaveBeenCalledOnce();
  expect(frames.size).toBe(0);
  act(() => renderer.update(<VoiceFlow level={0.8} active speaking palette="iris" theme="auto" />));
  tick();
  expect(engine.bars[0].drawFrame.mock.lastCall?.[0]).toMatchObject({ level: 0.8, reduced: true });
  expect(engine.bars[0].colorize).toHaveBeenLastCalledWith('iris', false);
  expect(trail.draw).toHaveBeenCalledOnce();
  media.matches = false;
  preference();
  tick();
  expect(frames.size).toBe(1);
});

it('pauses when hidden or inactive and cleans the existing frame and subscriptions on unmount', () => {
  mount();
  const wave = engine.bars[0];
  expect(frames.size).toBe(1);
  Object.assign(document, { hidden: true });
  visibility();
  expect(frames.size).toBe(0);
  Object.assign(document, { hidden: false });
  visibility();
  tick();
  expect(frames.size).toBe(1);
  act(() => renderer.update(<VoiceFlow level={0} active={false} theme="auto" />));
  tick();
  expect(wave.drawFrame.mock.lastCall?.[0].state).toBe('disabled');
  expect(frames.size).toBe(0);
  act(() => renderer.unmount());
  expect(wave.dispose).toHaveBeenCalledOnce();
  expect(document.removeEventListener).toHaveBeenCalledWith(
    'visibilitychange',
    expect.any(Function)
  );
  expect(media.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
});
