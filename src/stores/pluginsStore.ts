import { create } from 'zustand';
import * as api from '../api/plugins';
import type { InstalledPlugin, PluginRegistry, PluginRegion } from '../api/plugins';
import type { LocalTool } from '../api/types';
import bundledIndex from '../data/pluginIndex.json';
import { useNavigationStore } from './navigationStore';
import { detectLocale, resolveLocale } from '../i18n';

const active = () => useNavigationStore.getState().developerMode;
const bundledRegistry = bundledIndex as PluginRegistry;

function savedRegion(): PluginRegion | null {
  try {
    const saved = localStorage.getItem('echobird_plugin_region');
    if (saved === 'china' || saved === 'international') return saved;
  } catch {
    /* Use the interface language when storage is unavailable. */
  }
  return null;
}

const defaultRegion = (locale: string): PluginRegion =>
  resolveLocale(locale) === 'zh-Hans' ? 'china' : 'international';
const regionPreference = savedRegion();

export function pluginTools(plugins: InstalledPlugin[]): LocalTool[] {
  return plugins
    .filter((plugin) => plugin.enabled)
    .flatMap((plugin) =>
      plugin.manifest.echobird.contributes.pages.map((page) => ({
        id: `plugin:${plugin.id}:${page.id}`,
        name: page.title,
        category: 'Utility',
        installed: true,
        launchFile: 'plugin',
        version: plugin.manifest.version,
        website: plugin.manifest.repository,
        icon: plugin.icon ?? '',
        noModelConfig: !plugin.manifest.echobird.permissions.includes('model.request'),
        apiProtocol: ['openai', 'anthropic'],
        plugin: { id: plugin.id, pageId: page.id },
      }))
    );
}

interface PluginsState {
  installed: InstalledPlugin[];
  registry: PluginRegistry;
  region: PluginRegion;
  regionChosen: boolean;
  syncRegion: (locale: string) => void;
  selected: string | null;
  loaded: boolean;
  loading: boolean;
  busy: boolean;
  revision: number;
  error: string | null;
  load: () => Promise<void>;
  refresh: () => Promise<void>;
  select: (id: string | null) => void;
  setRegion: (region: PluginRegion) => void;
  install: (token: string) => Promise<void>;
  enable: (id: string, enabled: boolean) => Promise<void>;
  uninstall: (id: string) => Promise<void>;
}

export const usePluginsStore = create<PluginsState>((set, get) => {
  const mutate = async (action: () => Promise<InstalledPlugin[]>) => {
    if (!active() || get().busy) return;
    const revision = get().revision + 1;
    set({ busy: true, error: null, revision });
    try {
      const installed = await action();
      if (active() && revision === get().revision) set({ installed, loaded: true });
    } catch (error) {
      if (active() && revision === get().revision) set({ error: String(error) });
      throw error;
    } finally {
      if (revision === get().revision) set({ busy: false, revision: revision + 1 });
    }
  };
  return {
    installed: [],
    registry: bundledRegistry,
    region: regionPreference ?? defaultRegion(detectLocale()),
    regionChosen: regionPreference !== null,
    syncRegion: (locale) => {
      if (!get().regionChosen) set({ region: defaultRegion(locale ?? detectLocale()) });
    },
    selected: null,
    loaded: false,
    loading: false,
    busy: false,
    revision: 0,
    error: null,
    load: async () => {
      if (!active() || get().loading || get().busy) return;
      const revision = get().revision;
      set({ loading: true });
      try {
        const installed = await api.listPlugins();
        if (revision === get().revision) set({ installed, loaded: true, error: null });
      } catch (error) {
        if (revision === get().revision) set({ error: String(error) });
      } finally {
        if (revision === get().revision) set({ loading: false });
      }
    },
    refresh: async () => {
      if (!active() || get().loading || get().busy) return;
      const region = get().region;
      const revision = get().revision;
      set({ loading: true, error: null });
      try {
        const [installed, registry] = await Promise.all([
          api.listPlugins(),
          api.getPluginRegistry(region, true),
        ]);
        if (region === get().region && revision === get().revision)
          set({ installed, registry, loaded: true });
      } catch (error) {
        if (revision === get().revision) set({ error: String(error) });
      } finally {
        if (revision === get().revision) set({ loading: false });
      }
    },
    select: (selected) => set({ selected }),
    setRegion: (region) => {
      set({ region, regionChosen: true });
      try {
        localStorage.setItem('echobird_plugin_region', region);
      } catch {
        /* Keep the in-memory selection. */
      }
    },
    install: (token) => mutate(() => api.installPlugin(token)),
    enable: (id, enabled) => mutate(() => api.setPluginEnabled(id, enabled)),
    uninstall: (id) => mutate(() => api.uninstallPlugin(id)),
  };
});

useNavigationStore.subscribe((state, previous) => {
  if (state.developerMode !== previous.developerMode) {
    usePluginsStore.setState((plugins) => ({
      revision: plugins.revision + 1,
      loading: false,
      busy: false,
      error: null,
    }));
  }
});
