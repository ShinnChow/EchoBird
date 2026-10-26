// Tools store — shared state for detected tools and scanning
// Used by: App.tsx (init), AppManagerProvider, MotherAgentProvider

import { create } from 'zustand';
import * as api from '../api/tauri';
import type { LocalTool } from '../api/types';
import { preloadToolIcons } from '../utils/toolIcons';

const CACHE_KEY = 'echobird-tools-cache';
const platform = typeof navigator === 'undefined' ? '' : navigator.platform;

function isCachedTool(value: unknown): value is LocalTool {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const tool = value as Record<string, unknown>;
  return (
    typeof tool.id === 'string' &&
    tool.id.length > 0 &&
    typeof tool.name === 'string' &&
    typeof tool.category === 'string' &&
    typeof tool.installed === 'boolean' &&
    [
      'detectedPath',
      'configPath',
      'activeModel',
      'website',
      'iconBase64',
      'startCommand',
      'launchFile',
      'command',
      'version',
      'launchUri',
      'path',
      'icon',
      'displayName',
    ].every((key) => tool[key] === undefined || typeof tool[key] === 'string') &&
    ['noModelConfig', 'noCwdPrompt'].every(
      (key) => tool[key] === undefined || typeof tool[key] === 'boolean'
    ) &&
    (tool.apiProtocol === undefined ||
      (Array.isArray(tool.apiProtocol) &&
        tool.apiProtocol.every((value) => typeof value === 'string'))) &&
    (tool.names === undefined ||
      (tool.names !== null &&
        typeof tool.names === 'object' &&
        !Array.isArray(tool.names) &&
        Object.values(tool.names).every((value) => typeof value === 'string')))
  );
}

function readToolsCache(): LocalTool[] {
  try {
    const cache = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null');
    return cache?.version === 1 &&
      cache.platform === platform &&
      Array.isArray(cache.tools) &&
      cache.tools.every(isCachedTool)
      ? cache.tools
      : [];
  } catch {
    return [];
  }
}

interface ToolsState {
  detectedTools: LocalTool[];
  usingCachedTools: boolean;
  isScanning: boolean;
  hasScanned: boolean;
  setDetectedTools: (tools: LocalTool[] | ((prev: LocalTool[]) => LocalTool[])) => void;
  scanTools: () => Promise<void>;
}

const cachedTools = readToolsCache();

export const useToolsStore = create<ToolsState>((set, get) => ({
  detectedTools: cachedTools,
  usingCachedTools: cachedTools.length > 0,
  isScanning: false,
  hasScanned: false,
  setDetectedTools: (tools) => {
    const detectedTools = typeof tools === 'function' ? tools(get().detectedTools) : tools;
    set({
      detectedTools,
      hasScanned: true,
      usingCachedTools: typeof tools === 'function' ? get().usingCachedTools : false,
    });
    try {
      localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({ version: 1, platform, tools: detectedTools })
      );
    } catch {
      // The current desktop remains usable when persistent storage is unavailable.
    }
  },

  scanTools: async () => {
    if (get().isScanning) return;
    set({ isScanning: true });
    try {
      const tools = await api.scanTools();
      // Publish one complete desktop; keep the previous icons visible during refresh.
      get().setDetectedTools(await preloadToolIcons(tools));
    } catch {
      /* ignore */
    }
    set({ isScanning: false, hasScanned: true });
  },
}));
