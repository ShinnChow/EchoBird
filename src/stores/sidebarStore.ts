import { create } from 'zustand';

const STORAGE_KEY = 'echobird-sidebar-collapsed';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export const useSidebarStore = create<{
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
}>((set) => ({
  collapsed: readCollapsed(),
  setCollapsed: (collapsed) => {
    set({ collapsed });
    try {
      localStorage.setItem(STORAGE_KEY, String(collapsed));
    } catch {
      // Keep the current layout when local storage is unavailable.
    }
  },
}));
