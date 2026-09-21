export type ColorThemeId =
  | 'echobird'
  | 'solarized'
  | 'openscience'
  | 'openscience-1'
  | 'aura'
  | 'ayu'
  | 'catppuccin'
  | 'gruvbox'
  | 'monokai'
  | 'nightowl'
  | 'nord'
  | 'shadesofpurple';

export interface ColorThemeVariant {
  shell: string;
  canvas: string;
  secondary: string;
  tertiary: string;
  input: string;
}

export interface ColorTheme {
  id: ColorThemeId;
  labelZh: string;
  labelEn: string;
  labelJa: string;
  light: ColorThemeVariant;
  dark: ColorThemeVariant;
}

export const COLOR_THEMES: ColorTheme[] = [
  {
    id: 'echobird',
    labelZh: '暖灰',
    labelEn: 'Warm gray',
    labelJa: 'ウォームグレー',
    light: {
      shell: '#F7F6F3',
      canvas: '#EFEEEB',
      secondary: '#E8E6E0',
      tertiary: '#D8D5CD',
      input: '#FFFFFF',
    },
    dark: {
      shell: '#211F1C',
      canvas: '#211F1C',
      secondary: '#2A2723',
      tertiary: '#36322C',
      input: '#2E2B26',
    },
  },
  {
    id: 'openscience',
    labelZh: '燕麦',
    labelEn: 'Oat',
    labelJa: 'オート',
    light: {
      shell: '#EFE9DF',
      canvas: '#F7F4ED',
      secondary: '#FBF9F4',
      tertiary: '#FFFDF8',
      input: '#FFFFFF',
    },
    dark: {
      shell: '#202120',
      canvas: '#1C1D1C',
      secondary: '#252625',
      tertiary: '#2B2C2B',
      input: '#303130',
    },
  },
  {
    id: 'openscience-1',
    labelZh: '雾灰',
    labelEn: 'Mist',
    labelJa: 'ミスト',
    light: {
      shell: '#F2F2F2',
      canvas: '#F8F7F7',
      secondary: '#FFFFFF',
      tertiary: '#ECEBEB',
      input: '#FFFFFF',
    },
    dark: {
      shell: '#1C1717',
      canvas: '#151313',
      secondary: '#201C1C',
      tertiary: '#2A2424',
      input: '#2E2828',
    },
  },
  {
    id: 'catppuccin',
    labelZh: '拿铁',
    labelEn: 'Latte',
    labelJa: 'ラテ',
    light: {
      shell: '#F2D8D4',
      canvas: '#F5E0DC',
      secondary: '#F9E8E4',
      tertiary: '#EBCBC8',
      input: '#FDEEEE',
    },
    dark: {
      shell: '#211F31',
      canvas: '#1E1E2E',
      secondary: '#2A293D',
      tertiary: '#37354D',
      input: '#3D3A55',
    },
  },
  {
    id: 'gruvbox',
    labelZh: '奶油',
    labelEn: 'Cream',
    labelJa: 'クリーム',
    light: {
      shell: '#F2E5BC',
      canvas: '#FBF1C7',
      secondary: '#F9F5D7',
      tertiary: '#E8DDAF',
      input: '#FDF9E8',
    },
    dark: {
      shell: '#32302F',
      canvas: '#282828',
      secondary: '#353230',
      tertiary: '#45403C',
      input: '#4A4540',
    },
  },
  {
    id: 'monokai',
    labelZh: '芥末',
    labelEn: 'Mustard',
    labelJa: 'マスタード',
    light: {
      shell: '#F8F2E6',
      canvas: '#FDF8EC',
      secondary: '#FBF5E8',
      tertiary: '#EDE4D3',
      input: '#FFFDF7',
    },
    dark: {
      shell: '#27281F',
      canvas: '#23241E',
      secondary: '#2E3027',
      tertiary: '#3B3D32',
      input: '#414337',
    },
  },
  {
    id: 'solarized',
    labelZh: '青灰',
    labelEn: 'Teal gray',
    labelJa: 'ティールグレー',
    light: {
      shell: '#F6EFDA',
      canvas: '#FDF6E3',
      secondary: '#FAF3DC',
      tertiary: '#F6EDD4',
      input: '#FFFDF5',
    },
    dark: {
      shell: '#022733',
      canvas: '#001F27',
      secondary: '#01222B',
      tertiary: '#032830',
      input: '#062F39',
    },
  },
  {
    id: 'ayu',
    labelZh: '松灰',
    labelEn: 'Pine',
    labelJa: 'パイン',
    light: {
      shell: '#FCF9F3',
      canvas: '#FDFAF4',
      secondary: '#FBF8F2',
      tertiary: '#EEE9DF',
      input: '#FFFFFF',
    },
    dark: {
      shell: '#18222C',
      canvas: '#0F1419',
      secondary: '#18212A',
      tertiary: '#222E39',
      input: '#273440',
    },
  },
  {
    id: 'nightowl',
    labelZh: '深海',
    labelEn: 'Deep sea',
    labelJa: '深海',
    light: {
      shell: '#F0F0F0',
      canvas: '#FBFBFB',
      secondary: '#FFFFFF',
      tertiary: '#E6EDF2',
      input: '#FFFFFF',
    },
    dark: {
      shell: '#0B253A',
      canvas: '#011627',
      secondary: '#0B2132',
      tertiary: '#153047',
      input: '#19384F',
    },
  },
  {
    id: 'nord',
    labelZh: '冰川',
    labelEn: 'Glacier',
    labelJa: 'グレイシャー',
    light: {
      shell: '#E4E8F0',
      canvas: '#ECEFF4',
      secondary: '#F1F3F8',
      tertiary: '#D8DDE7',
      input: '#F6F8FC',
    },
    dark: {
      shell: '#222938',
      canvas: '#1F2430',
      secondary: '#2A3040',
      tertiary: '#373E50',
      input: '#3D4558',
    },
  },
  {
    id: 'aura',
    labelZh: '薰衣草',
    labelEn: 'Lavender',
    labelJa: 'ラベンダー',
    light: {
      shell: '#EFE8FC',
      canvas: '#F5F0FF',
      secondary: '#FAF7FF',
      tertiary: '#E7DDF8',
      input: '#FDFCFF',
    },
    dark: {
      shell: '#1A1921',
      canvas: '#15141B',
      secondary: '#201E29',
      tertiary: '#2B2836',
      input: '#302C3C',
    },
  },
  {
    id: 'shadesofpurple',
    labelZh: '葡萄紫',
    labelEn: 'Grape',
    labelJa: 'グレープ',
    light: {
      shell: '#F2E2FF',
      canvas: '#F7EBFF',
      secondary: '#FBF2FF',
      tertiary: '#E5D0F4',
      input: '#FFF7FF',
    },
    dark: {
      shell: '#1F1434',
      canvas: '#1A102B',
      secondary: '#281A40',
      tertiary: '#382453',
      input: '#40295D',
    },
  },
];

export const isColorThemeId = (value: unknown): value is ColorThemeId =>
  COLOR_THEMES.some((theme) => theme.id === value);

export const getColorTheme = (id: ColorThemeId): ColorTheme =>
  COLOR_THEMES.find((theme) => theme.id === id) ?? COLOR_THEMES[0];
