// AI Skills — Curated, application-oriented AI skills for builders, indie hackers,
// and creators. Focus: "how to USE AI to ship things" (vibe coding, agent orchestration,
// content creation, AI-powered startups) — NOT how to research/train LLMs.
//
// Both lists live as JSON on echobird.ai/skills (CF Worker), with GitHub raw at
// docs/skills/{cn,en}.json as the secondary mirror. Edit those files to add/remove
// entries without shipping a release; users pull fresh data within the 6h cache window
// (or instantly via the refresh button).
//
// The bundled CN_SKILLS / EN_SKILLS arrays below are the offline floor: shown on
// cold start before remote fetch completes and as a fallback when both mirrors fail.

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { open as shellOpen } from '@tauri-apps/plugin-shell';
import { RefreshCw, Star, X } from 'lucide-react';
import { useI18n } from '../../hooks/useI18n';
import { usePulseScroll } from '../../hooks/usePulseScroll';
import { useConfirm } from '../../components/ConfirmDialog';
import { ModelIdCombobox } from '../../components/ModelIdCombobox';
import * as api from '../../api/tauri';
import type { SkillConfig } from '../../api/types';
import {
  parseGithubRepo,
  fetchGithubStars,
  fetchGithubRepoInfo,
  formatStars,
} from '../../utils/githubStars';

// ===== Mirror config =====

// Both langs share the same mirror chain; only the file name differs. Primary is
// echobird.ai's CF Worker; GitHub raw is the cold backup that auto-tracks main.
const SKILLS_MIRRORS: { name: string; base: string }[] = [
  { name: 'echobird', base: 'https://echobird.ai/skills' },
  {
    name: 'github',
    base: 'https://raw.githubusercontent.com/edison7009/EchoBird/main/docs/skills',
  },
];

const SKILLS_FILE_EN = 'en.json';
const SKILLS_FILE_CN = 'cn.json';
const SKILLS_FILE_ZH_HANT = 'zh-Hant.json';
const SKILLS_FILE_JA = 'ja.json';

// ===== Types =====

type Lang = 'en' | 'zh-Hans' | 'zh-Hant' | 'ja';

interface Skill {
  id: string;
  name: string;
  url: string;
  description: string;
  category: string;
  lang: Lang;
}

type Tab = 'hot' | 'fav';

interface NewSkillForm {
  name: string;
  url: string;
  category: string;
  description: string;
}

interface CachedEn {
  enSkills: Skill[];
  enCategories: string[];
  fetchedAt: number;
}

interface CachedZh {
  zhSkills: Skill[];
  zhCategories: string[];
  fetchedAt: number;
}

interface CachedZhHant {
  zhHantSkills: Skill[];
  zhHantCategories: string[];
  fetchedAt: number;
}

interface CachedJa {
  jaSkills: Skill[];
  jaCategories: string[];
  fetchedAt: number;
}

interface Catalog {
  skills: Skill[];
  categoriesByLang: Record<Lang, string[]>;
  fetchedAt: number;
}

// ===== Local cache =====
//
// `:v2` bump invalidates the old dair-ai academic content that used to live under
// `skills:cache:en` so users instantly see the new applied-direction list after upgrade.
const CACHE_KEY_EN = 'skills:cache:en:v2';
const CACHE_KEY_ZH = 'skills:cache:zh';
const CACHE_KEY_ZH_HANT = 'skills:cache:zh-hant';
const CACHE_KEY_JA = 'skills:cache:ja';
const REFRESH_AFTER_MS = 6 * 3600 * 1000;

const loadCachedEn = (): CachedEn | null => {
  try {
    const raw = localStorage.getItem(CACHE_KEY_EN);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.enSkills) || !Array.isArray(parsed?.enCategories)) return null;
    return parsed as CachedEn;
  } catch {
    return null;
  }
};
const saveCachedEn = (c: CachedEn) => {
  try {
    localStorage.setItem(CACHE_KEY_EN, JSON.stringify(c));
  } catch {
    /* quota */
  }
};

const loadCachedZh = (): CachedZh | null => {
  try {
    const raw = localStorage.getItem(CACHE_KEY_ZH);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.zhSkills) || !Array.isArray(parsed?.zhCategories)) return null;
    return parsed as CachedZh;
  } catch {
    return null;
  }
};
const saveCachedZh = (c: CachedZh) => {
  try {
    localStorage.setItem(CACHE_KEY_ZH, JSON.stringify(c));
  } catch {
    /* quota */
  }
};

const loadCachedZhHant = (): CachedZhHant | null => {
  try {
    const raw = localStorage.getItem(CACHE_KEY_ZH_HANT);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.zhHantSkills) || !Array.isArray(parsed?.zhHantCategories))
      return null;
    return parsed as CachedZhHant;
  } catch {
    return null;
  }
};
const saveCachedZhHant = (c: CachedZhHant) => {
  try {
    localStorage.setItem(CACHE_KEY_ZH_HANT, JSON.stringify(c));
  } catch {
    /* quota */
  }
};

const loadCachedJa = (): CachedJa | null => {
  try {
    const raw = localStorage.getItem(CACHE_KEY_JA);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.jaSkills) || !Array.isArray(parsed?.jaCategories)) return null;
    return parsed as CachedJa;
  } catch {
    return null;
  }
};
const saveCachedJa = (c: CachedJa) => {
  try {
    localStorage.setItem(CACHE_KEY_JA, JSON.stringify(c));
  } catch {
    /* quota */
  }
};

// Each lang has both a remote source and a bundled fallback now — buildCatalog
// merges remote-or-bundled per lang.
const buildCatalog = (
  en: CachedEn | null,
  zhHans: CachedZh | null,
  zhHant: CachedZhHant | null,
  ja: CachedJa | null
): Catalog => {
  // No bundled fallback - if remote fails, the lang shows empty until next fetch.
  const enSkills = en?.enSkills ?? [];
  const enCategories = en?.enCategories ?? [];
  const zhHansSkills = zhHans?.zhSkills ?? [];
  const zhHansCategories = zhHans?.zhCategories ?? [];
  const zhHantSkills = zhHant?.zhHantSkills ?? [];
  const zhHantCategories = zhHant?.zhHantCategories ?? [];
  const jaSkills = ja?.jaSkills ?? [];
  const jaCategories = ja?.jaCategories ?? [];
  return {
    skills: [...enSkills, ...zhHansSkills, ...zhHantSkills, ...jaSkills],
    categoriesByLang: {
      en: enCategories,
      'zh-Hans': zhHansCategories,
      'zh-Hant': zhHantCategories,
      ja: jaCategories,
    },
    fetchedAt:
      Math.max(
        en?.fetchedAt ?? 0,
        zhHans?.fetchedAt ?? 0,
        zhHant?.fetchedAt ?? 0,
        ja?.fetchedAt ?? 0
      ) || Date.now(),
  };
};

// ===== Network: mirror-aware JSON fetch =====
//
// Same shape for both lists: { skills: Omit<Skill, 'lang'>[], categories: string[] }.
// No preferredMirror optimization — VPN switches change which mirror works, so don't
// cache the choice.

const looksLikeHtml = (s: string): boolean => {
  const head = s.slice(0, 200).trimStart().toLowerCase();
  return head.startsWith('<!doctype html') || head.startsWith('<html');
};

async function fetchSkillsJson(
  file: string,
  lang: Lang
): Promise<{ skills: Skill[]; categories: string[] }> {
  let lastErr: unknown = null;
  for (const mirror of SKILLS_MIRRORS) {
    try {
      const res = await fetch(`${mirror.base}/${file}`, { cache: 'no-cache' });
      if (!res.ok) {
        lastErr = new Error(`${mirror.name} ${res.status}`);
        continue;
      }
      const text = await res.text();
      if (looksLikeHtml(text)) {
        lastErr = new Error(`${mirror.name} returned HTML`);
        continue;
      }
      const json = JSON.parse(text);
      if (!Array.isArray(json?.skills) || !Array.isArray(json?.categories)) {
        lastErr = new Error(`${mirror.name} invalid shape`);
        continue;
      }
      const skills: Skill[] = json.skills.map((c: Omit<Skill, 'lang'>) => ({
        ...c,
        lang,
      }));
      return { skills, categories: json.categories as string[] };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`all ${lang} mirrors failed`);
}

// ===== Helpers =====

// Fisher-Yates shuffle - used to randomize the hot-tab preset order each time
// the list changes, so the 22 curated skills don't always appear in the same
// sequence. Returns a new array (does not mutate input).
const shuffle = <T,>(arr: T[]): T[] => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const openExternal = (url: string) => shellOpen(url).catch(() => window.open(url, '_blank'));
const urlPathOf = (url: string): string => {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    const path = u.pathname.replace(/\/$/, '');
    return path && path !== '/' ? `${host}${path}` : host;
  } catch {
    return url;
  }
};

// ===== Context =====

interface SkillsContextValue {
  catalog: Catalog;
  initialLoading: boolean;
  syncing: boolean;
  error: string | null;
  selectedCategory: string;
  setSelectedCategory: (c: string) => void;
  retry: () => void;
  stars: Record<string, number>;
  tab: Tab;
  setTab: (t: Tab) => void;
  userSkills: SkillConfig[];
  showAddSkillModal: boolean;
  modalAnimatingOut: boolean;
  openAddSkill: () => void;
  closeAddSkill: () => void;
  editingSkill: SkillConfig | null;
  openEditSkill: (s: SkillConfig) => void;
  submitSkill: () => Promise<void>;
  deleteSkill: (id: string) => Promise<void>;
  newSkillForm: NewSkillForm;
  setNewSkillForm: React.Dispatch<React.SetStateAction<NewSkillForm>>;
  fetchRepoInfo: () => Promise<void>;
  fetchingInfo: boolean;
}

const SkillsContext = createContext<SkillsContextValue | null>(null);

function useSkills() {
  const ctx = useContext(SkillsContext);
  if (!ctx) throw new Error('Skills context missing');
  return ctx;
}

// ===== Provider =====

export function SkillsProvider({ children }: { children: React.ReactNode }) {
  // Hydrate caches once on mount so re-renders don't re-read localStorage.
  const initialCachedEn = useMemo(() => loadCachedEn(), []);
  const initialCachedZh = useMemo(() => loadCachedZh(), []);
  const initialCachedZhHant = useMemo(() => loadCachedZhHant(), []);
  const initialCachedJa = useMemo(() => loadCachedJa(), []);
  const [cachedEn, setCachedEn] = useState<CachedEn | null>(initialCachedEn);
  const [cachedZh, setCachedZh] = useState<CachedZh | null>(initialCachedZh);
  const [cachedZhHant, setCachedZhHant] = useState<CachedZhHant | null>(initialCachedZhHant);
  const [cachedJa, setCachedJa] = useState<CachedJa | null>(initialCachedJa);
  // Skeleton only when BOTH caches are cold — bundled arrays still render content
  // for both langs even when nothing is cached, so this is more of a "first sync
  // is in flight" hint than a "we have nothing to show" gate.
  const [initialLoading, setInitialLoading] = useState(
    initialCachedEn === null && initialCachedZh === null
  );
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const seq = useRef(0);
  const cacheRefEn = useRef(cachedEn);
  const cacheRefZh = useRef(cachedZh);
  const cacheRefZhHant = useRef(cachedZhHant);
  const cacheRefJa = useRef(cachedJa);
  useEffect(() => {
    cacheRefEn.current = cachedEn;
  }, [cachedEn]);
  useEffect(() => {
    cacheRefZh.current = cachedZh;
  }, [cachedZh]);
  useEffect(() => {
    cacheRefZhHant.current = cachedZhHant;
  }, [cachedZhHant]);
  useEffect(() => {
    cacheRefJa.current = cachedJa;
  }, [cachedJa]);

  const catalog = useMemo(
    () => buildCatalog(cachedEn, cachedZh, cachedZhHant, cachedJa),
    [cachedEn, cachedZh, cachedZhHant, cachedJa]
  );

  // ── User-saved skills (favorites) - persisted to ~/.echobird/config/skills.json ──
  const [userSkills, setUserSkills] = useState<SkillConfig[]>([]);
  useEffect(() => {
    api
      .getSkills()
      .then(setUserSkills)
      .catch(() => {});
  }, []);
  // ── Tab: hot / fav (persisted to localStorage) ──
  const [tab, setTabState] = useState<Tab>(() =>
    localStorage.getItem('skills:tab') === 'fav' ? 'fav' : 'hot'
  );
  const setTab = useCallback((t: Tab) => {
    setTabState(t);
    try {
      localStorage.setItem('skills:tab', t);
    } catch {
      /* quota */
    }
  }, []);

  // ── Add/Edit skill modal state ──
  const [showAddSkillModal, setShowAddSkillModal] = useState(false);
  const [modalAnimatingOut, setModalAnimatingOut] = useState(false);
  const [editingSkill, setEditingSkill] = useState<SkillConfig | null>(null);
  const [newSkillForm, setNewSkillForm] = useState<NewSkillForm>({
    name: '',
    url: '',
    category: '',
    description: '',
  });
  const [fetchingInfo, setFetchingInfo] = useState(false);

  const openAddSkill = useCallback(() => {
    setEditingSkill(null);
    setNewSkillForm({ name: '', url: '', category: '', description: '' });
    setShowAddSkillModal(true);
  }, []);
  const openEditSkill = useCallback((s: SkillConfig) => {
    setEditingSkill(s);
    setNewSkillForm({
      name: s.name,
      url: s.url,
      category: s.category,
      description: s.description,
    });
    setShowAddSkillModal(true);
  }, []);
  const closeAddSkill = useCallback(() => {
    setModalAnimatingOut(true);
    setTimeout(() => {
      setShowAddSkillModal(false);
      setModalAnimatingOut(false);
      setEditingSkill(null);
    }, 200);
  }, []);
  const fetchRepoInfo = useCallback(async () => {
    const repo = parseGithubRepo(newSkillForm.url);
    if (!repo) {
      // Non-GitHub URL - spin briefly then no-op (per product: silent, no toast).
      setFetchingInfo(true);
      setTimeout(() => setFetchingInfo(false), 600);
      return;
    }
    setFetchingInfo(true);
    try {
      const info = await fetchGithubRepoInfo(repo.owner, repo.repo);
      if (info) {
        setNewSkillForm((prev) => ({
          ...prev,
          name: info.name,
          description: info.description,
        }));
      }
    } catch {
      /* silent */
    } finally {
      setFetchingInfo(false);
    }
  }, [newSkillForm.url]);
  const submitSkill = useCallback(async () => {
    try {
      if (editingSkill) {
        const updated = await api.updateSkill(editingSkill.id, {
          name: newSkillForm.name,
          url: newSkillForm.url,
          category: newSkillForm.category,
          description: newSkillForm.description,
        });
        if (updated) {
          setUserSkills((prev) => prev.map((s) => (s.id === editingSkill.id ? updated : s)));
        }
      } else {
        const created = await api.addSkill({
          name: newSkillForm.name,
          url: newSkillForm.url,
          category: newSkillForm.category,
          description: newSkillForm.description,
        });
        setUserSkills((prev) => [...prev, created]);
      }
    } catch {
      /* silent - per product: no error UI, mirror model add flow */
    }
    closeAddSkill();
  }, [editingSkill, newSkillForm, closeAddSkill]);
  const deleteSkill = useCallback(async (id: string) => {
    try {
      const ok = await api.deleteSkill(id);
      if (ok) setUserSkills((prev) => prev.filter((s) => s.id !== id));
    } catch {
      /* silent */
    }
  }, []);

  // GitHub star counts for any repo-URL skill. Prefetched once per catalog
  // change; fetchGithubStars itself caches in localStorage for 7 days, so this
  // is a cheap read after the first hit.
  const [stars, setStars] = useState<Record<string, number>>({});
  // Prefetch star counts for every repo-URL skill. `force` bypasses the 7-day
  // localStorage cache so the refresh button can re-pull on demand.
  const prefetchStars = useCallback(
    (force: boolean) => {
      const repos = new Map<string, { owner: string; repo: string }>();
      for (const s of catalog.skills) {
        const r = parseGithubRepo(s.url);
        if (r) repos.set(`${r.owner}/${r.repo}`, r);
      }
      for (const s of userSkills) {
        const r = parseGithubRepo(s.url);
        if (r) repos.set(`${r.owner}/${r.repo}`, r);
      }
      if (repos.size === 0) return;
      let cancelled = false;
      void Promise.all(
        Array.from(repos.values()).map(async (r) => {
          const count = await fetchGithubStars(r.owner, r.repo, force);
          return [`${r.owner}/${r.repo}`, count] as const;
        })
      ).then((entries) => {
        if (cancelled) return;
        setStars((prev) => {
          let changed = false;
          const next = { ...prev };
          for (const [k, v] of entries) {
            if (v != null && next[k] !== v) {
              next[k] = v;
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      });
      return () => {
        cancelled = true;
      };
    },
    [catalog, userSkills]
  );
  useEffect(() => {
    return prefetchStars(false);
  }, [prefetchStars]);

  const sync = useCallback(async (force = false) => {
    const curEn = cacheRefEn.current;
    const curZh = cacheRefZh.current;
    const curZhHant = cacheRefZhHant.current;
    const curJa = cacheRefJa.current;
    const enFresh = !force && curEn && Date.now() - curEn.fetchedAt < REFRESH_AFTER_MS;
    const zhFresh = !force && curZh && Date.now() - curZh.fetchedAt < REFRESH_AFTER_MS;
    const zhHantFresh = !force && curZhHant && Date.now() - curZhHant.fetchedAt < REFRESH_AFTER_MS;
    const jaFresh = !force && curJa && Date.now() - curJa.fetchedAt < REFRESH_AFTER_MS;

    if (enFresh && zhFresh && zhHantFresh && jaFresh) {
      setInitialLoading(false);
      return;
    }

    const my = ++seq.current;
    setSyncing(true);
    setError(null);

    let latestError: string | null = null;
    const tasks: Promise<void>[] = [];

    if (!enFresh) {
      tasks.push(
        fetchSkillsJson(SKILLS_FILE_EN, 'en')
          .then(({ skills, categories }) => {
            if (my !== seq.current) return;
            const fresh: CachedEn = {
              enSkills: skills,
              enCategories: categories,
              fetchedAt: Date.now(),
            };
            saveCachedEn(fresh);
            setCachedEn(fresh);
          })
          .catch((e: unknown) => {
            latestError = e instanceof Error ? e.message : 'EN fetch failed';
          })
      );
    }

    if (!zhFresh) {
      tasks.push(
        fetchSkillsJson(SKILLS_FILE_CN, 'zh-Hans')
          .then(({ skills, categories }) => {
            if (my !== seq.current) return;
            const fresh: CachedZh = {
              zhSkills: skills,
              zhCategories: categories,
              fetchedAt: Date.now(),
            };
            saveCachedZh(fresh);
            setCachedZh(fresh);
          })
          .catch((e: unknown) => {
            latestError = e instanceof Error ? e.message : 'CN fetch failed';
          })
      );
    }

    if (!zhHantFresh) {
      tasks.push(
        fetchSkillsJson(SKILLS_FILE_ZH_HANT, 'zh-Hant')
          .then(({ skills, categories }) => {
            if (my !== seq.current) return;
            const fresh: CachedZhHant = {
              zhHantSkills: skills,
              zhHantCategories: categories,
              fetchedAt: Date.now(),
            };
            saveCachedZhHant(fresh);
            setCachedZhHant(fresh);
          })
          .catch((e: unknown) => {
            latestError = e instanceof Error ? e.message : 'ZH-Hant fetch failed';
          })
      );
    }

    if (!jaFresh) {
      tasks.push(
        fetchSkillsJson(SKILLS_FILE_JA, 'ja')
          .then(({ skills, categories }) => {
            if (my !== seq.current) return;
            const fresh: CachedJa = {
              jaSkills: skills,
              jaCategories: categories,
              fetchedAt: Date.now(),
            };
            saveCachedJa(fresh);
            setCachedJa(fresh);
          })
          .catch((e: unknown) => {
            latestError = e instanceof Error ? e.message : 'JA fetch failed';
          })
      );
    }

    await Promise.allSettled(tasks);

    if (my === seq.current) {
      // Error UI only surfaces when visible.length === 0 anyway — bundled fallbacks
      // mean users never see it in practice.
      if (latestError) setError(latestError);
      setInitialLoading(false);
      setSyncing(false);
    }
  }, []);

  const retry = useCallback(() => {
    sync(true);
    prefetchStars(true);
  }, [sync, prefetchStars]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    sync();
  }, [sync]);

  const value = useMemo<SkillsContextValue>(
    () => ({
      catalog,
      initialLoading,
      syncing,
      error,
      selectedCategory,
      setSelectedCategory,
      retry,
      stars,
      tab,
      setTab,
      userSkills,
      showAddSkillModal,
      modalAnimatingOut,
      openAddSkill,
      closeAddSkill,
      editingSkill,
      openEditSkill,
      submitSkill,
      deleteSkill,
      newSkillForm,
      setNewSkillForm,
      fetchRepoInfo,
      fetchingInfo,
    }),
    [
      catalog,
      initialLoading,
      syncing,
      error,
      selectedCategory,
      retry,
      stars,
      tab,
      setTab,
      userSkills,
      showAddSkillModal,
      modalAnimatingOut,
      openAddSkill,
      closeAddSkill,
      editingSkill,
      openEditSkill,
      submitSkill,
      deleteSkill,
      newSkillForm,
      fetchRepoInfo,
      fetchingInfo,
    ]
  );

  return <SkillsContext.Provider value={value}>{children}</SkillsContext.Provider>;
}

// ===== Title actions =====

export function SkillsTitleActions() {
  const { t } = useI18n();
  const { syncing, retry, tab, setTab } = useSkills();
  return (
    <div className="ml-auto flex-shrink-0 flex items-center gap-2">
      <div className="flex items-center rounded-md border border-cyber-border/50 overflow-hidden">
        <button
          onClick={() => setTab('hot')}
          className={`text-sm px-3 py-1.5 transition-colors ${
            tab === 'hot'
              ? 'bg-cyber-text/10 text-cyber-text'
              : 'text-cyber-text-secondary hover:bg-cyber-text/5'
          }`}
        >
          {t('skills.tab.hot')}
        </button>
        <button
          onClick={() => setTab('fav')}
          className={`text-sm px-3 py-1.5 transition-colors border-l border-cyber-border/50 ${
            tab === 'fav'
              ? 'bg-cyber-text/10 text-cyber-text'
              : 'text-cyber-text-secondary hover:bg-cyber-text/5'
          }`}
        >
          {t('skills.tab.fav')}
        </button>
      </div>
      <button
        onClick={retry}
        disabled={syncing}
        className={`text-sm px-3 py-1.5 border rounded-md transition-colors flex items-center gap-2 ${
          !syncing
            ? 'border-cyber-border/50 text-cyber-text hover:bg-cyber-text/10'
            : 'border-cyber-border text-cyber-text-muted cursor-not-allowed'
        }`}
      >
        <RefreshCw size={13} className={syncing ? 'animate-spin' : ''} />
        {t('btn.refresh')}
      </button>
    </div>
  );
}

// ===== Card =====

function SkillCard({
  skill,
  selected,
  onSelect,
  onEdit,
  onDelete,
}: {
  skill: Omit<Skill, 'lang'>;
  selected: boolean;
  onSelect: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const { t } = useI18n();
  const { stars } = useSkills();
  const confirm = useConfirm();
  const repo = parseGithubRepo(skill.url);
  const starCount = repo ? stars[`${repo.owner}/${repo.repo}`] : undefined;

  const handleUrlClick = (e: ReactMouseEvent) => {
    e.stopPropagation();
    openExternal(skill.url);
  };

  const handleDelete = async (e: ReactMouseEvent) => {
    e.stopPropagation();
    const ok = await confirm({
      title: t('skills.deleteTitle'),
      message: t('skills.deleteConfirm'),
      confirmText: t('btn.delete'),
      cancelText: t('btn.cancel'),
      type: 'danger',
    });
    if (ok) onDelete?.();
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      className={`group w-full text-left bg-cyber-surface rounded-card border transition-colors h-48 p-4 flex flex-col cursor-pointer relative overflow-hidden ${
        selected
          ? 'border-cyber-accent'
          : 'border-cyber-border/15 hover:border-cyber-border/40 hover:bg-cyber-elevated'
      }`}
    >
      {(onEdit || onDelete) && (
        <div className="absolute top-2 right-2 flex gap-1.5 z-10">
          {onDelete && (
            <button
              className="text-xs font-mono text-cyber-text-muted/70 hover:text-red-500 transition-colors"
              onClick={handleDelete}
            >
              [{t('btn.delete')}]
            </button>
          )}
          {onEdit && (
            <button
              className="text-xs font-mono text-cyber-text-muted/70 hover:text-cyber-text transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
            >
              [{t('btn.edit')}]
            </button>
          )}
        </div>
      )}
      <div className="text-xs text-cyber-text-secondary tracking-wide mb-1 truncate">
        {skill.category}
      </div>
      <div className="min-h-[6.4375rem]">
        <div className="text-[15px] font-bold text-cyber-text leading-snug mb-2 group-hover:text-cyber-accent transition-colors line-clamp-2">
          {skill.name}
        </div>

        {skill.description && (
          <div className="text-[13px] text-cyber-text-secondary leading-snug line-clamp-3">
            {skill.description}
          </div>
        )}
      </div>

      <div className="mt-auto pt-2 border-t border-cyber-border/10 flex items-center gap-2">
        <button
          type="button"
          onClick={handleUrlClick}
          className="text-xs font-mono text-cyber-text-muted hover:text-cyber-accent truncate flex-1 text-left transition-colors"
        >
          {urlPathOf(skill.url)}
        </button>
        {repo && starCount != null && (
          <span className="flex items-center gap-0.5 text-xs font-mono text-cyber-text-muted shrink-0">
            <Star size={12} className="fill-current" />
            {formatStars(starCount)}
          </span>
        )}
      </div>
    </div>
  );
}

// ===== Main =====

export function SkillsMain() {
  const { t, locale } = useI18n();
  const {
    catalog,
    initialLoading,
    syncing,
    error,
    selectedCategory,
    retry,
    tab,
    userSkills,
    openAddSkill,
    openEditSkill,
    deleteSkill,
  } = useSkills();
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const handleSelect = useCallback((id: string) => {
    setSelectedSkillId((prev) => (prev === id ? null : id));
  }, []);
  // Only zh-Hans gets the CN list (Bilibili / Datawhale / 飞桨 etc. on CN-domestic
  // platforms). zh-Hant (TW/HK/MO) and ja users see the EN list — TW/HK builders
  // follow the international AI stack (Anthropic Academy / LangChain / HF), not the
  // CN-domestic ecosystem.
  const lang: Lang =
    locale === 'zh-Hans'
      ? 'zh-Hans'
      : locale === 'zh-Hant'
        ? 'zh-Hant'
        : locale === 'ja'
          ? 'ja'
          : 'en';

  const visible = useMemo(() => {
    if (tab === 'fav') {
      if (selectedCategory === 'all') return userSkills;
      return userSkills.filter((s) => s.category === selectedCategory);
    }
    const langMatched = catalog.skills.filter((c) => c.lang === lang);
    const list =
      selectedCategory === 'all'
        ? langMatched
        : langMatched.filter((c) => c.category === selectedCategory);
    // Hot tab: shuffle so the curated 22 don't always show in the same order.
    return shuffle(list);
  }, [tab, catalog, userSkills, selectedCategory, lang]);

  if (tab === 'hot' && (initialLoading || syncing) && visible.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="h-48 p-4 bg-cyber-surface rounded-card animate-pulse">
              <div className="h-3 w-20 bg-cyber-border/40 rounded mb-2" />
              <div className="h-5 w-3/4 bg-cyber-border/50 rounded mb-3" />
              <div className="h-3 w-full bg-cyber-border/30 rounded mb-2" />
              <div className="h-3 w-2/3 bg-cyber-border/30 rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (tab === 'hot' && error && visible.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto">
        <div className="p-8 text-center text-sm font-mono">
          <div className="text-cyber-warning mb-2">{t('pulse.fetchFailed')}</div>
          <div className="text-xs text-cyber-text-muted/60 mb-4 break-all max-w-md mx-auto">
            {error}
          </div>
          <button
            onClick={retry}
            className="text-xs px-4 py-2 border border-cyber-border/50 rounded text-cyber-text hover:bg-cyber-text/10 transition-colors"
          >
            {t('btn.refresh')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {visible.map((c) => (
          <SkillCard
            key={c.id}
            skill={c}
            selected={selectedSkillId === c.id}
            onSelect={() => handleSelect(c.id)}
            onEdit={tab === 'fav' ? () => openEditSkill(c as SkillConfig) : undefined}
            onDelete={tab === 'fav' ? () => deleteSkill(c.id) : undefined}
          />
        ))}
        {tab === 'fav' && (
          <div
            className="h-48 border border-dashed border-cyber-border flex flex-col items-center justify-center hover:border-cyber-border cursor-pointer transition-all rounded-card text-cyber-text-secondary hover:text-cyber-text"
            onClick={openAddSkill}
          >
            <span className="font-bold tracking-wider">{t('skills.addRepo')}</span>
            <span className="text-[10px] opacity-60 mt-1">GitHub</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ===== Right panel: category filter =====

export function SkillsPanel() {
  const { t, locale } = useI18n();
  const { catalog, selectedCategory, setSelectedCategory, tab, userSkills } = useSkills();
  const scrollRef = usePulseScroll<HTMLDivElement>();
  // Same lang fork as SkillsMain — see comment there.
  const lang: Lang =
    locale === 'zh-Hans'
      ? 'zh-Hans'
      : locale === 'zh-Hant'
        ? 'zh-Hant'
        : locale === 'ja'
          ? 'ja'
          : 'en';

  // Reset filter when categories of the current lang don't include the selection
  const langSkills = useMemo(() => catalog.skills.filter((c) => c.lang === lang), [catalog, lang]);
  const list = tab === 'fav' ? userSkills : langSkills;
  const categories = useMemo(() => {
    if (tab === 'fav') {
      const set = new Set<string>();
      for (const s of userSkills) if (s.category) set.add(s.category);
      return Array.from(set);
    }
    return catalog.categoriesByLang[lang] || [];
  }, [tab, userSkills, catalog, lang]);
  const total = list.length;
  const countByCat = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of list) m.set(c.category, (m.get(c.category) || 0) + 1);
    return m;
  }, [list]);

  // Reset filter when categories don't include the selection
  useEffect(() => {
    if (selectedCategory === 'all') return;
    if (!categories.includes(selectedCategory)) setSelectedCategory('all');
  }, [categories, selectedCategory, setSelectedCategory]);

  return (
    <>
      <div className="px-3 py-2 mb-1 flex items-center justify-between bg-transparent">
        <div className="text-[15px] font-semibold text-cyber-text">{t('skills.filter')}</div>
        {total > 0 && <span className="text-[13px] font-mono text-cyber-text-muted">{total}</span>}
      </div>
      <div ref={scrollRef} className="flex-1 px-2 overflow-y-auto pb-4 space-y-1 pulse-scroll">
        <button
          onClick={() => setSelectedCategory('all')}
          className={`w-full text-left px-3 py-2 rounded text-[14px] transition-colors flex items-center justify-between ${
            selectedCategory === 'all'
              ? 'bg-cyber-elevated text-cyber-text font-medium'
              : 'text-cyber-text-secondary hover:bg-cyber-surface hover:text-cyber-text'
          }`}
        >
          <span>{t('skills.cat.all')}</span>
          <span className="text-[13px] font-mono text-cyber-text-muted">{total}</span>
        </button>
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setSelectedCategory(cat)}
            className={`w-full text-left px-3 py-2 rounded text-[14px] transition-colors flex items-center justify-between ${
              selectedCategory === cat
                ? 'bg-cyber-elevated text-cyber-text font-medium'
                : 'text-cyber-text-secondary hover:bg-cyber-surface hover:text-cyber-text'
            }`}
          >
            <span className="truncate">{cat}</span>
            <span className="text-[13px] font-mono text-cyber-text-muted ml-2">
              {countByCat.get(cat) || 0}
            </span>
          </button>
        ))}
      </div>
    </>
  );
}

// ===== Add/Edit Skill Modal =====

export function AddSkillModal() {
  const { t, locale } = useI18n();
  const {
    showAddSkillModal,
    modalAnimatingOut,
    editingSkill,
    newSkillForm,
    setNewSkillForm,
    closeAddSkill,
    submitSkill,
    fetchRepoInfo,
    fetchingInfo,
    catalog,
    userSkills,
  } = useSkills();

  // Category suggestions: existing categories for the current locale + categories
  // already used by the user's saved skills (deduped). Free-text still allowed.
  const lang: Lang =
    locale === 'zh-Hans'
      ? 'zh-Hans'
      : locale === 'zh-Hant'
        ? 'zh-Hant'
        : locale === 'ja'
          ? 'ja'
          : 'en';
  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const c of catalog.categoriesByLang[lang] || []) set.add(c);
    for (const s of userSkills) if (s.category) set.add(s.category);
    return Array.from(set);
  }, [catalog, userSkills, lang]);

  if (!showAddSkillModal) return null;

  return (
    <div
      className={`fixed inset-0 z-[9998] flex items-center justify-center transition-all duration-200 ${modalAnimatingOut ? 'opacity-0' : 'opacity-100'}`}
      onKeyDown={(e) => {
        if (e.key === 'Escape') closeAddSkill();
      }}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={closeAddSkill} />
      <div
        className={`relative w-[450px] max-w-[90vw] border border-cyber-border/30 bg-cyber-surface shadow-2xl rounded-xl overflow-hidden transition-all duration-200 ${modalAnimatingOut ? 'scale-95 opacity-0' : 'scale-100 opacity-100'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-px w-full bg-cyber-border" />
        <div className="px-6 pt-5 pb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-cyber-text font-mono text-sm opacity-60">&gt;_</span>
            <span className="text-base font-bold text-cyber-text">
              {editingSkill ? t('skills.editRepo') : t('skills.addRepo')}
            </span>
          </div>
          <button
            onClick={closeAddSkill}
            className="text-cyber-text-secondary hover:text-cyber-text transition-colors"
          >
            <X size={18} />
          </button>
        </div>
        <div className="px-5 pb-5">
          <div className="space-y-4">
            {/* Address (first) + fetch-info button */}
            <div>
              <label className="block text-xs text-cyber-text-secondary mb-1">
                {t('skills.field.url')}
              </label>
              <div className="relative">
                <input
                  type="text"
                  placeholder={t('skills.placeholder.url')}
                  value={newSkillForm.url}
                  onChange={(e) => setNewSkillForm((prev) => ({ ...prev, url: e.target.value }))}
                  className="w-full bg-cyber-input border border-cyber-border px-2 py-1.5 pr-20 text-xs text-cyber-text font-mono focus:border-cyber-border focus:outline-none rounded-button"
                />
                <button
                  type="button"
                  onClick={fetchRepoInfo}
                  disabled={fetchingInfo || !newSkillForm.url}
                  className={`absolute right-2 top-1/2 -translate-y-1/2 text-xs text-cyber-text-secondary flex items-center gap-1 ${
                    !newSkillForm.url || fetchingInfo
                      ? 'opacity-50 cursor-not-allowed'
                      : 'cursor-pointer'
                  }`}
                >
                  <RefreshCw size={11} className={fetchingInfo ? 'animate-spin' : ''} />
                  {t('skills.fetchInfo')}
                </button>
              </div>
            </div>
            {/* Name */}
            <div>
              <label className="block text-xs text-cyber-text-secondary mb-1">
                {t('skills.field.name')}
              </label>
              <input
                type="text"
                placeholder={t('skills.placeholder.name')}
                value={newSkillForm.name}
                onChange={(e) => setNewSkillForm((prev) => ({ ...prev, name: e.target.value }))}
                className="w-full bg-cyber-input border border-cyber-border px-2 py-1.5 text-xs text-cyber-text font-mono focus:border-cyber-border focus:outline-none rounded-button"
              />
            </div>
            {/* Category (free input + suggestions) */}
            <div>
              <label className="block text-xs text-cyber-text-secondary mb-1">
                {t('skills.field.category')}
              </label>
              <ModelIdCombobox
                value={newSkillForm.category}
                onChange={(v) => setNewSkillForm((prev) => ({ ...prev, category: v }))}
                options={categoryOptions}
                placeholder={t('skills.placeholder.category')}
              />
            </div>
            {/* Description (textarea) */}
            <div>
              <label className="block text-xs text-cyber-text-secondary mb-1">
                {t('skills.field.description')}
              </label>
              <textarea
                rows={3}
                placeholder={t('skills.placeholder.description')}
                value={newSkillForm.description}
                onChange={(e) =>
                  setNewSkillForm((prev) => ({ ...prev, description: e.target.value }))
                }
                className="w-full bg-cyber-input border border-cyber-border px-2 py-1.5 text-xs text-cyber-text font-mono focus:border-cyber-border focus:outline-none rounded-button resize-none"
              />
            </div>
          </div>
        </div>
        {/* Footer */}
        <div className="flex border-t border-cyber-border">
          <button
            onClick={closeAddSkill}
            className="flex-1 px-4 py-3 text-[14px] font-semibold text-cyber-text-secondary hover:text-cyber-text hover:bg-cyber-elevated transition-all border-r border-cyber-border"
          >
            {t('btn.cancel')}
          </button>
          <button
            onClick={submitSkill}
            className="flex-1 px-4 py-3 text-[14px] font-semibold text-cyber-text hover:bg-cyber-text/10 transition-all"
          >
            {editingSkill ? t('btn.save') : t('skills.addRepo')}
          </button>
        </div>
      </div>
    </div>
  );
}
