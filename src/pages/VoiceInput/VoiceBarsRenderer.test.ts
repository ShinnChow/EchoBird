import { afterEach, expect, it, vi } from 'vitest';
import { VoiceBarsRenderer } from './VoiceBarsRenderer';
import { voicePalettes } from './voicePalettes';

afterEach(() => vi.unstubAllGlobals());

it('keeps the existing short bars and tints the full viewport after scrolling', () => {
  let points: number[][] = [];
  const stops: [number, string][] = [];
  const fills: { blend: string; fill: unknown }[] = [];
  const gradient = { addColorStop: (at: number, color: string) => stops.push([at, color]) };
  const ctx = {
    strokeStyle: '',
    fillStyle: undefined as unknown,
    globalCompositeOperation: 'source-over',
    lineWidth: 0,
    setTransform: vi.fn(),
    clearRect: vi.fn(() => {
      points = [];
    }),
    beginPath: () => {},
    stroke: () => {},
    moveTo: (x: number, y: number) => points.push([x, y]),
    lineTo: (x: number, y: number) => points.push([x, y]),
    createLinearGradient: vi.fn(() => gradient),
    fillRect: vi.fn(() => fills.push({ blend: ctx.globalCompositeOperation, fill: ctx.fillStyle })),
  };
  const canvas = { width: 0, height: 0, getContext: () => ctx, remove: vi.fn() };
  vi.stubGlobal('document', { createElement: () => canvas });
  vi.stubGlobal('getComputedStyle', () => ({ color: '#ececec' }));
  const bars = new VoiceBarsRenderer({ appendChild: vi.fn() } as unknown as HTMLElement, 1.25);
  const frame = { state: 'speaking' as const, level: 0, reduced: false, light: false };
  bars.drawFrame(frame, 1 / 60);
  expect([canvas.width, canvas.height]).toEqual([100, 30]);
  expect(points).toHaveLength(40);
  expect(Math.min(...points.map(([, y]) => y)) - ctx.lineWidth / 2).toBe(10);
  bars.drawFrame({ ...frame, level: 1 }, 1 / 60);
  expect(Math.min(...points.map(([, y]) => y)) - ctx.lineWidth / 2).toBe(5);
  expect(Math.max(...points.map(([, y]) => y)) + ctx.lineWidth / 2).toBe(19);
  expect(ctx.strokeStyle).toBe('#fff');
  bars.colorize('white', false);
  expect(fills[0]).toEqual({ blend: 'source-in', fill: '#ececec' });
  for (const palette of voicePalettes.filter((p) => p !== 'white')) {
    stops.length = 0;
    bars.colorize(palette, false);
    expect(stops[0][0]).toBe(0);
    expect(stops[stops.length - 1][0]).toBe(1);
    expect(stops[0][1]).not.toBe(stops[stops.length - 1][1]);
    expect(fills[fills.length - 1]).toEqual({ blend: 'source-in', fill: gradient });
    expect(ctx.globalCompositeOperation).toBe('source-over');
  }
  expect(ctx.fillRect).toHaveBeenLastCalledWith(0, 0, 80, 24);
  bars.dispose();
  expect(canvas.remove).toHaveBeenCalledOnce();
});
