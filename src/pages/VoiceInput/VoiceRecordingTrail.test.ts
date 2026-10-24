import { afterEach, expect, it, vi } from 'vitest';
import { VoiceRecordingTrail } from './VoiceRecordingTrail';

afterEach(() => vi.unstubAllGlobals());

// Each numbered column stands for an already drawn feature, not a new wave phase.
function raster(width: number, height: number) {
  const image = { width, height, columns: Array.from({ length: width }, (_, i) => i + 1) };
  const saved: string[] = [];
  const ctx = {
    globalCompositeOperation: 'source-over',
    imageSmoothingEnabled: true,
    globalAlpha: 1,
    save: () => saved.push(ctx.globalCompositeOperation),
    restore: () => {
      ctx.globalCompositeOperation = saved.pop()!;
    },
    setTransform: vi.fn(),
    clearRect: (x: number, _y: number, w: number) => {
      image.columns.fill(0, x, x + w);
    },
    drawImage: (source: typeof image, ...args: number[]) => {
      const columns = [...source.columns];
      const sx = args.length === 2 ? 0 : args[0];
      const sw = args.length === 2 ? source.width : args[2];
      const dx = args.length === 2 ? args[0] : args[4];
      const dw = args.length === 2 ? source.width : args[6];
      if (ctx.globalCompositeOperation === 'copy') image.columns.fill(0);
      for (let i = 0; i < dw; i++) {
        const x = dx + i;
        if (x >= 0 && x < width) image.columns[x] = columns[Math.floor(sx + (i * sw) / dw)] ?? 0;
      }
    },
  };
  return Object.assign(image, { getContext: () => ctx, ctx });
}

it.each([1, 1.25, 1.4, 2])(
  'moves existing columns left and appends only new right-edge columns at DPR %s',
  (ratio) => {
    const width = Math.round(80 * ratio);
    const source = raster(width, Math.round(24 * ratio));
    const history = raster(width, source.height);
    vi.stubGlobal('document', { createElement: () => history });
    const trail = new VoiceRecordingTrail(source as unknown as HTMLCanvasElement, ratio);
    const initial = [...source.columns];
    trail.draw(0);
    expect(source.columns).toEqual(initial);
    source.columns = initial.map((_, x) => 1000 + x);
    trail.draw(1 / (32 * ratio));
    expect(source.columns.slice(0, -1)).toEqual(initial.slice(1));
    expect(source.columns[width - 1]).toBe(1000 + Math.floor(width / 2));
    const moved = [...source.columns];
    source.columns.fill(2000);
    trail.draw(0.5 / (32 * ratio));
    expect(source.columns).toEqual(moved);
    source.columns.fill(2000);
    trail.draw(0.5 / (32 * ratio));
    expect(source.columns.slice(0, -1)).toEqual(moved.slice(1));
    expect(source.columns[width - 1]).toBe(2000);
    expect(history.ctx.imageSmoothingEnabled).toBe(false);
    expect(source.ctx.setTransform).toHaveBeenCalledWith(1, 0, 0, 1, 0, 0);
    trail.reset();
    expect(history.columns.every((value) => value === 0)).toBe(true);
    source.columns.fill(3000);
    trail.draw(0);
    expect(source.columns.every((value) => value === 3000)).toBe(true);
  }
);
