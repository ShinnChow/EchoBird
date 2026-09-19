// Tools store — shared state for detected tools and scanning
// Used by: App.tsx (init), AppManagerProvider, MotherAgentProvider

import { create } from 'zustand';
import * as api from '../api/tauri';
import type { LocalTool } from '../api/types';

interface ToolsState {
  detectedTools: LocalTool[];
  isScanning: boolean;
  setDetectedTools: (tools: LocalTool[] | ((prev: LocalTool[]) => LocalTool[])) => void;
  scanTools: () => Promise<void>;
}

export const useToolsStore = create<ToolsState>((set, _get) => ({
  detectedTools: [],
  isScanning: false,
  setDetectedTools: (tools) =>
    set((state) => ({
      detectedTools: typeof tools === 'function' ? tools(state.detectedTools) : tools,
    })),

  scanTools: async () => {
    set({ isScanning: true });
    try {
      const tools = await api.scanTools();
      set({ detectedTools: tools });
    } catch {
      /* ignore */
    }
    set({ isScanning: false });
  },
}));
