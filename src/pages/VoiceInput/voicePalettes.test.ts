import { expect, it } from 'vitest';
import { voicePaletteColor, voicePalettes, voicePaletteStops } from './voicePalettes';

it('keeps the default inherited foreground and samples harmonious palettes across the full wave', () => {
  expect(voicePaletteColor('white', 0.5)).toBeUndefined();
  expect(voicePaletteColor('aurora', 0)).toBe('rgb(16,185,129)');
  expect(voicePaletteColor('aurora', 1 / 3)).toBe('rgb(6,182,212)');
  expect(voicePaletteColor('aurora', 1)).toBe('rgb(168,85,247)');
  expect(voicePaletteColor('aurora', 0, true)).toBe('rgb(11,126,88)');
  for (const palette of voicePalettes.filter((p) => p !== 'white')) {
    expect(voicePaletteStops[palette].length).toBeGreaterThanOrEqual(3);
    expect(
      new Set(Array.from({ length: 28 }, (_, i) => voicePaletteColor(palette, i / 27))).size
    ).toBeGreaterThan(20);
  }
});
