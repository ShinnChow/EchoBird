import { invoke } from '@tauri-apps/api/core';
import type { ModelConfig } from './types';

export type VoiceApiProtocol =
  | 'openai'
  | 'chatAudio'
  | 'mimo'
  | 'openrouter'
  | 'gemini'
  | 'doubao'
  | 'minimax';
export const voiceProtocols: Record<VoiceApiProtocol, string> = {
  openai: 'OpenAI / Whisper',
  chatAudio: 'Qwen ASR',
  mimo: 'MiMo ASR',
  openrouter: 'OpenRouter',
  gemini: 'Google Gemini',
  doubao: 'Doubao ASR',
  minimax: 'MiniMax ASR',
};
export interface VoiceApiOptions {
  protocol: VoiceApiProtocol;
}
export interface VoiceDirectoryEntry {
  name: string;
  url: string;
  baseUrl: string;
  modelId: string;
  modelIds: string[];
  protocol: VoiceApiProtocol;
  region: string;
}

export interface VoiceChannel {
  kind: 'workbuddy' | 'model';
  id: string;
}
export interface VoiceBinding {
  code: string;
  modifiers: string[];
}
export type VoicePalette = 'white' | 'aurora' | 'ocean' | 'sunset' | 'iris';

export interface VoiceConfig {
  channels: VoiceChannel[];
  apiOptions?: Record<string, VoiceApiOptions>;
  microphone: string | null;
  shortcutEnabled: boolean;
  hotkeyEnabled: boolean;
  shortcut: VoiceBinding;
  islandTheme: 'auto' | 'dark' | 'light' | 'system';
  islandPalette: VoicePalette;
  optimizationEnabled: boolean;
  optimizationModel: string | null;
  optimizationMode: 'faithful' | 'semantic' | 'terms';
  translationLanguage: 'off' | 'zh-Hans' | 'zh-Hant' | 'en' | 'ja' | 'ko' | 'fr' | 'de' | 'es';
}
export interface VoiceUsage {
  characters: number;
  durationMs: number;
}
export interface VoiceSnapshot {
  config: VoiceConfig;
  days: Record<string, number>;
  usage: VoiceUsage;
  phase:
    | 'idle'
    | 'starting'
    | 'recording'
    | 'testing'
    | 'transcribing'
    | 'optimizing'
    | 'inserting'
    | 'done'
    | 'error';
  level: number;
  elapsedMs: number;
  text: string;
  error: string | null;
  revision: number;
  shortcutActive: boolean;
  shortcutDescription: string | null;
  appIcon: string | null;
  appIconLoading: boolean;
  origin: 'page' | 'test' | 'shortcut' | 'island';
}
export const getVoiceState = () => invoke<VoiceSnapshot>('voice_input_state');
export const getVoiceModels = () => invoke<ModelConfig[]>('voice_input_models');
export const getVoiceDevices = () => invoke<string[]>('voice_input_devices');
export const saveVoiceConfig = (config: VoiceConfig) =>
  invoke<VoiceSnapshot>('voice_input_save', { config });
export const startVoice = () => invoke<VoiceSnapshot>('voice_input_start');
export const recordVoice = () => invoke<VoiceSnapshot>('voice_input_record');
export const stopVoice = () => invoke<VoiceSnapshot>('voice_input_stop');
export const cancelVoice = () => invoke<VoiceSnapshot>('voice_input_cancel');
export const suspendVoiceShortcut = (suspended: boolean) =>
  invoke<void>('voice_input_suspend', { suspended });
export const voiceIslandReady = () => invoke<VoiceSnapshot>('voice_input_island_ready');
export const copyVoiceResult = () => invoke<void>('voice_input_copy_result');
export const showMainWindow = () => invoke<void>('voice_input_show_main');
