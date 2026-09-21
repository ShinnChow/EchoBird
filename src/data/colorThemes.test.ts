import { describe, expect, it } from 'vitest';
import { COLOR_THEMES, getColorTheme, isColorThemeId } from './colorThemes';

describe('color themes', () => {
  it('keeps unique ids and paired light/dark palettes', () => {
    expect(new Set(COLOR_THEMES.map((theme) => theme.id)).size).toBe(COLOR_THEMES.length);
    for (const theme of COLOR_THEMES) {
      for (const variant of [theme.light, theme.dark]) {
        expect(Object.values(variant).every((color) => /^#[0-9A-F]{6}$/i.test(color))).toBe(true);
      }
    }
  });

  it('validates ids and falls back to EchoBird', () => {
    expect(isColorThemeId('nord')).toBe(true);
    expect(isColorThemeId('unknown')).toBe(false);
    expect(getColorTheme('echobird').id).toBe('echobird');
  });
});
