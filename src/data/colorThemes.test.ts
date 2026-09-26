import { describe, expect, it } from 'vitest';
import { COLOR_THEMES, getColorTheme, isColorThemeId } from './colorThemes';

describe('color themes', () => {
  it('keeps unique ids and valid paired palettes', () => {
    expect(new Set(COLOR_THEMES.map((theme) => theme.id)).size).toBe(COLOR_THEMES.length);
    expect(COLOR_THEMES.length).toBe(18);
    for (const theme of COLOR_THEMES)
      for (const variant of [theme.light, theme.dark])
        expect(Object.values(variant).every((color) => /^#[0-9A-F]{6}$/i.test(color))).toBe(true);
  });
  it('uses the oat gray artwork as the default', () => {
    expect(isColorThemeId('oatgray')).toBe(true);
    expect(getColorTheme('oatgray').labelZh).toBe('燕麦暖灰');
  });
});
