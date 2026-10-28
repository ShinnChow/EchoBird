import { useEffect } from 'react';
import { emit, listen } from '@tauri-apps/api/event';
import { usePluginProductStore } from '../stores/pluginProductStore';
import { usePluginsStore } from '../stores/pluginsStore';
import { useNavigationStore } from '../stores/navigationStore';
import { useThemeStore, THEME_CHANGED_EVENT, THEME_REQUEST_EVENT } from '../stores/themeStore';
export function PluginProductBridge() {
  const active = useNavigationStore((state) => state.developerMode);
  const installed = usePluginsStore((state) => state.installed);
  const palette = usePluginProductStore((state) => state.snapshot.palette);
  useEffect(() => {
    if (!active) {
      usePluginProductStore.getState().reset();
      return;
    }
    void usePluginsStore.getState().load();
  }, [active]);
  useEffect(() => {
    if (active) void usePluginProductStore.getState().load();
  }, [active, installed]);
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    const registration = listen('plugin-sdk-changed', () => {
      if (!disposed) void usePluginProductStore.getState().load();
    });
    return () => {
      disposed = true;
      void registration.then((stop) => stop()).catch(() => {});
    };
  }, [active]);
  useEffect(() => {
    useThemeStore.getState().setPluginTheme(active ? palette : null);
  }, [active, palette]);
  useEffect(() => {
    let disposed = false;
    const registration = listen(THEME_REQUEST_EVENT, () => {
      if (disposed) return;
      const { mode, colorTheme } = useThemeStore.getState();
      void emit(THEME_CHANGED_EVENT, {
        mode,
        colorTheme,
        pluginTheme: active ? palette : null,
      }).catch(() => {});
    });
    return () => {
      disposed = true;
      void registration.then((stop) => stop()).catch(() => {});
    };
  }, [active, palette]);
  useEffect(() => () => useThemeStore.getState().setPluginTheme(null), []);
  return null;
}
