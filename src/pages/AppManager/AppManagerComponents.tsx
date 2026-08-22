import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Server as ServerIcon, Box as BoxIcon, Download, RefreshCw, Settings } from 'lucide-react';
import { getModelIcon, EffortPulse } from '../../components';
import { useI18n } from '../../hooks/useI18n';
import * as api from '../../api/tauri';
import type { ModelConfig, LocalTool } from '../../api/types';
import type { TKey } from '../../i18n';
import { useAppManager } from './context';
import { useNavigationStore } from '../../stores/navigationStore';
import {
  getOfficialEndpoint,
  officialModelSentinel,
  type OfficialEndpoint,
} from '../../data/officialEndpoints';

// ===== Title actions (refresh) — mounted in the shared page title bar,
// keeping App Management consistent with the other pages =====

export const AppManagerTitleActions: React.FC = () => {
  const { t } = useI18n();
  const { scanTools, isScanning } = useAppManager();

  return (
    <div className="ml-auto flex-shrink-0 flex items-center gap-2">
      {/* Custom scan paths — opens ~/.echobird/tool-paths.json so users can
          register install locations EchoBird's bundled defaults missed.
          Borderless icon (no button chrome), sized to the refresh button's
          height so the two read as a pair. */}
      <button
        onClick={() => {
          void api.openToolPathsConfig().catch(() => {});
        }}
        title={t('btn.editPaths')}
        aria-label={t('btn.editPaths')}
        className="flex items-center text-cyber-text-secondary hover:text-cyber-text transition-colors outline-none"
      >
        <Settings size={20} />
      </button>
      <button
        onClick={scanTools}
        disabled={isScanning}
        className={`text-sm px-3 py-1.5 border rounded-md transition-colors flex items-center gap-2 outline-none ${
          !isScanning
            ? 'border-cyber-border/50 text-cyber-text hover:bg-cyber-text/10'
            : 'border-cyber-border text-cyber-text-muted cursor-not-allowed'
        }`}
      >
        <RefreshCw size={13} className={isScanning ? 'animate-spin' : ''} />
        {t('btn.refresh')}
      </button>
    </div>
  );
};

// ===== Main Content (AI Desktop grid) =====

// Category order for the "未安装" (not installed) grouping. The installed
// section renders flat (no category headers per spec); only the uninstalled
// section groups by category with i18n titles.
const CATEGORY_ORDER = ['Desktop', 'IDE', 'CLI Code', 'Science', 'AutoTrading', 'Game', 'Utility'];

// Within Desktop, keep the fixed display order (Coffee CLI last).
const DESKTOP_ORDER: Record<string, number> = {
  claudedesktop: 0,
  chatgptdesktop: 1,
  geminidesktop: 2,
  coffeecli: 99,
};

const categoryRank = (cat?: string): number => {
  const idx = CATEGORY_ORDER.indexOf(cat || '');
  return idx === -1 ? 99 : idx;
};

// Within-category tiebreaker: Desktop keeps its fixed display order (Coffee
// CLI last); Science keeps OpenScience first (its model-config support is
// solid while Claude Science is macOS/Linux-only with thinner support).
const withinCategoryRank = (tool: LocalTool): number => {
  if (tool.category === 'Desktop') return DESKTOP_ORDER[tool.id] ?? 50;
  if (tool.category === 'Science') return tool.id === 'openscience' ? 0 : 1;
  return 0;
};

// Stable order across the desktop: category rank, then the within-category
// tiebreaker, then name.
const compareTools = (a: LocalTool, b: LocalTool): number => {
  const catDiff = categoryRank(a.category) - categoryRank(b.category);
  if (catDiff !== 0) return catDiff;
  const rankDiff = withinCategoryRank(a) - withinCategoryRank(b);
  if (rankDiff !== 0) return rankDiff;
  return a.name.localeCompare(b.name);
};

const catLabelKey = (cat: string): TKey => {
  const map: Record<string, TKey> = {
    IDE: 'toolCat.ide',
    'CLI Code': 'toolCat.cli',
    AutoTrading: 'toolCat.autoTrading',
    Game: 'toolCat.game',
    Desktop: 'toolCat.desktop',
    Utility: 'toolCat.utility',
    Science: 'toolCat.science',
  };
  return map[cat] || (cat as TKey);
};

// Localized display name — resolves per-locale `names` like ToolCard, but
// prefers `displayName` when present (the pre-localized label some tools
// carry), then falls back to the plain name.
const toolDisplayName = (tool: LocalTool, locale: string): string => {
  if (tool.displayName) return tool.displayName;
  if (tool.names && locale !== 'en') {
    return (
      tool.names[locale] ||
      tool.names[locale.split('-')[0]] ||
      Object.entries(tool.names).find(([k]) => k.startsWith(locale.split('-')[0]))?.[1] ||
      tool.name
    );
  }
  return tool.name;
};

interface DesktopIconProps {
  tool: LocalTool;
  selected: boolean;
  onClick: () => void;
}

// A desktop-style launcher tile: icon on top, name beneath. Clicking selects;
// the bottom bar holds the launch / install action. Uninstalled apps render
// dimmed with a small download badge, hinting the "一键安装" flow.
const DesktopIcon: React.FC<DesktopIconProps> = ({ tool, selected, onClick }) => {
  const { locale } = useI18n();
  const [iconSrc, setIconSrc] = useState<string>(`./icons/tools/${tool.id}.svg`);
  const displayName = toolDisplayName(tool, locale);

  const handleIconError = () => {
    setIconSrc((prev) => {
      if (prev.endsWith('.svg')) return `./icons/tools/${tool.id}.png`;
      if (tool.iconBase64 && prev !== tool.iconBase64) return tool.iconBase64;
      return '';
    });
  };

  return (
    <button
      onClick={onClick}
      aria-label={displayName}
      className="flex flex-col items-center gap-1.5 px-1.5 py-3 rounded-xl outline-none transition-colors select-none cursor-pointer focus-visible:ring-2 focus-visible:ring-cyber-accent"
    >
      {/* The icon alone is the graphic — no tile background behind it; the
          icon itself renders at the tile size. */}
      <span className="relative flex items-center justify-center">
        {iconSrc ? (
          <img
            src={iconSrc}
            alt=""
            draggable={false}
            onError={handleIconError}
            className={`w-14 h-14 object-contain ${tool.installed || selected ? '' : 'opacity-80'}`}
          />
        ) : (
          <BoxIcon size={44} className="text-cyber-text-secondary" />
        )}
        {!tool.installed && (
          <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-cyber-accent flex items-center justify-center ring-2 ring-cyber-bg">
            <Download size={10} className="text-white" />
          </span>
        )}
      </span>
      {/* Name wraps gracefully across up to two lines; the selected tile
          tints its label rather than drawing a highlight box. */}
      <span
        className={`text-xs leading-snug text-center w-full line-clamp-2 break-words ${
          selected
            ? 'text-cyber-accent'
            : tool.installed
              ? 'text-cyber-text'
              : 'text-cyber-text-secondary'
        }`}
      >
        {displayName}
      </span>
    </button>
  );
};

export const AppManagerMain: React.FC = () => {
  const { t } = useI18n();
  const { detectedTools, isScanning, selectedTool, setSelectedTool, aiInstallableIds } =
    useAppManager();
  // Active category tab for the "未安装" section. 'ALL' shows every
  // uninstalled app; the other tabs filter by category.
  const [activeUninstalledCat, setActiveUninstalledCat] = useState('ALL');

  const installed = useMemo(
    () => detectedTools.filter((tool) => tool.installed).sort(compareTools),
    [detectedTools]
  );
  const uninstalled = useMemo(
    () => detectedTools.filter((tool) => !tool.installed),
    [detectedTools]
  );

  // Category tabs present among the uninstalled apps: the canonical order
  // first, then any unknown categories alphabetically.
  const uninstalledCats = useMemo(() => {
    const cats = Array.from(new Set(uninstalled.map((t) => t.category).filter(Boolean)));
    return [
      ...CATEGORY_ORDER.filter((cat) => cats.includes(cat)),
      ...cats.filter((cat) => !CATEGORY_ORDER.includes(cat)).sort(),
    ];
  }, [uninstalled]);

  // Apps shown under the active tab. AI-installable first, then the
  // within-category tiebreaker, then name.
  const visibleUninstalled = useMemo(() => {
    const list =
      activeUninstalledCat === 'ALL'
        ? uninstalled
        : uninstalled.filter((t) => t.category === activeUninstalledCat);
    return [...list].sort((a, b) => {
      const aAi = aiInstallableIds.includes(a.id) ? 0 : 1;
      const bAi = aiInstallableIds.includes(b.id) ? 0 : 1;
      if (aAi !== bAi) return aAi - bAi;
      const rankDiff = withinCategoryRank(a) - withinCategoryRank(b);
      if (rankDiff !== 0) return rankDiff;
      return a.name.localeCompare(b.name);
    });
  }, [uninstalled, activeUninstalledCat, aiInstallableIds]);

  const renderIcon = (tool: LocalTool) => (
    <DesktopIcon
      key={tool.id}
      tool={tool}
      selected={selectedTool === tool.id}
      onClick={() => setSelectedTool(tool.id)}
    />
  );

  const gridClass = 'grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-x-2 gap-y-4';

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {isScanning && detectedTools.length === 0 ? (
        <div className={gridClass}>
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="flex flex-col items-center gap-1.5 px-2 py-3 rounded-xl animate-pulse"
            >
              <span className="w-14 h-14 rounded-xl bg-cyber-border/30" />
              <span className="w-12 h-3 bg-cyber-border/30 rounded" />
            </div>
          ))}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto pulse-scroll pr-1">
          {/* Installed — flat grid, no section header (per spec) */}
          {installed.length > 0 && (
            <div className="mb-8">
              <div className={gridClass}>{installed.map(renderIcon)}</div>
            </div>
          )}

          {/* Not installed — category tabs switch the grid */}
          {uninstalled.length > 0 && (
            <section>
              <div className="flex items-center gap-3 mb-3 flex-wrap">
                <h3 className="text-sm font-bold tracking-wider text-cyber-text flex-shrink-0">
                  {t('aiDesktop.notInstalled')}
                </h3>
                <span className="text-xs text-cyber-text-muted flex-shrink-0">
                  {uninstalled.length}
                </span>
                <div className="flex gap-1">
                  <button
                    onClick={() => setActiveUninstalledCat('ALL')}
                    className={`px-3 py-1.5 text-[13px] transition-colors outline-none ${
                      activeUninstalledCat === 'ALL'
                        ? 'text-cyber-text font-bold border-b-2 border-cyber-border'
                        : 'text-cyber-text-secondary hover:text-cyber-text'
                    }`}
                  >
                    {t('toolCat.all')}
                  </button>
                  {uninstalledCats.map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setActiveUninstalledCat(cat)}
                      className={`px-3 py-1.5 text-[13px] transition-colors outline-none ${
                        activeUninstalledCat === cat
                          ? 'text-cyber-text font-bold border-b-2 border-cyber-border'
                          : 'text-cyber-text-secondary hover:text-cyber-text'
                      }`}
                    >
                      {t(catLabelKey(cat))}
                    </button>
                  ))}
                </div>
              </div>
              <div className={gridClass}>{visibleUninstalled.map(renderIcon)}</div>
            </section>
          )}
        </div>
      )}
    </div>
  );
};

// ===== Model List Section =====

interface ModelListSectionProps {
  selectedToolData: LocalTool;
  userModels: ModelConfig[];
  toolModelConfig: Record<string, string | null>;
  selectedTool: string | null;
  handleSelectModel: (toolId: string, modelId: string) => void;
  modelProtocolSelection: Record<string, 'openai' | 'anthropic'>;
  setModelProtocolSelection: React.Dispatch<
    React.SetStateAction<Record<string, 'openai' | 'anthropic'>>
  >;
  /** When set, the card whose model id matches plays a one-shot apply pulse
   *  (keyed by nonce so re-applying replays it). Omitted where unused. */
  appliedPulse?: { id: string; nonce: number } | null;
  t: (key: TKey) => string;
}

// The coral "effort pulse" played once on a model card the instant its config
// is applied (生效). It OVERLAYS the card (z-20, above the model info) and fills
// it, so for its ~11s it obscures the icon / name / URL, plays, then dissolves to
// reveal them again. It paints its own envelope-faded page-colour backdrop,
// carries its own timing, and unmounts when the trigger clears.
// pointer-events-none lets clicks fall through to the card.
// Apply sound, played in sync with the pulse for its whole ~11s. Different
// models will get different tracks later; for now every apply plays the
// "xiaomi" test track. The keyed remount (see the callers) restarts it on
// re-apply; unmounting (pulse cancelled, e.g. tool switch) stops it.
const APPLY_SOUND = '/sounds/xiaomi.mp3';
const ModelCardPulse: React.FC = () => {
  useEffect(() => {
    const audio = new Audio(APPLY_SOUND);
    audio.play().catch(() => {
      /* autoplay blocked or file missing — the visual still plays */
    });
    return () => {
      audio.pause();
      audio.currentTime = 0;
    };
  }, []);
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
      <EffortPulse fill oneShot />
    </div>
  );
};

export const ModelListSection: React.FC<ModelListSectionProps> = ({
  selectedToolData,
  userModels,
  toolModelConfig,
  selectedTool,
  handleSelectModel,
  modelProtocolSelection,
  setModelProtocolSelection,
  appliedPulse,
  t,
}) => {
  const toolProtocols = useMemo(
    () => selectedToolData.apiProtocol || ['openai', 'anthropic'],
    [selectedToolData.apiProtocol]
  );

  const { localModels, cloudModels } = useMemo(() => {
    const compatible = userModels.filter((model) => {
      const hasOpenAI = toolProtocols.includes('openai') && !!model.baseUrl;
      const hasAnthropic = toolProtocols.includes('anthropic') && !!model.anthropicUrl;
      return hasOpenAI || hasAnthropic;
    });
    return {
      localModels: compatible.filter((m) => m.internalId === 'local-server'),
      cloudModels: compatible.filter((m) => m.internalId !== 'local-server'),
    };
  }, [userModels, toolProtocols]);

  const renderModelCard = (model: (typeof userModels)[0]) => {
    const isSelected = selectedTool ? toolModelConfig[selectedTool] === model.internalId : false;
    const isLocalServer = model.internalId === 'local-server';

    const modelHasBoth = !!(model.baseUrl && model.anthropicUrl);
    const toolSupportsBoth =
      toolProtocols.includes('openai') && toolProtocols.includes('anthropic');
    const showSwitcher = modelHasBoth && toolSupportsBoth;

    let currentProtocol = 'openai';
    if (toolSupportsBoth) {
      // Default to the protocol the model's URL actually speaks (see
      // applyModelConfig for the matching apply-side default). A single-URL model
      // must not inherit toolProtocols[0] — that would display (and apply) an
      // OpenAI-only model as Anthropic, 404-ing at call time. Only a both-URL
      // model keeps the toolProtocols[0] default, since its ⇄ switcher can change it.
      const defaultProtocol = modelHasBoth
        ? toolProtocols[0] === 'anthropic'
          ? 'anthropic'
          : 'openai'
        : model.anthropicUrl
          ? 'anthropic'
          : 'openai';
      currentProtocol = modelProtocolSelection[model.internalId] || defaultProtocol;
    } else {
      currentProtocol = toolProtocols[0];
    }

    const displayUrl =
      currentProtocol === 'anthropic'
        ? model.anthropicUrl || model.baseUrl
        : model.baseUrl || model.anthropicUrl;
    const apiPath = (() => {
      try {
        const url = new URL(displayUrl || '');
        const path = url.pathname === '/' ? '' : url.pathname;
        return url.hostname + path;
      } catch {
        return displayUrl || 'No URL Configured';
      }
    })();

    // Resolve icon from the MODEL ID only — mirror the model-nexus 配置 tab
    // (ModelCard.tsx). Passing the platform name (e.g.「千问AI平台」) here
    // matched the platform rule and showed qianwen.png even when the model
    // id was glm-5.2. The 官方端点 card below keeps name-based resolution
    // because ep.name is the vendor's own endpoint name, not a platform card.
    const iconSrc = getModelIcon('', model.modelId || '');

    return (
      <div
        key={model.internalId}
        className={`relative overflow-hidden p-3 rounded cursor-pointer transition-colors mb-2 flex items-center gap-3 border bg-cyber-surface ${
          isSelected ? 'border-cyber-accent' : 'border-transparent hover:bg-cyber-elevated'
        }`}
        onClick={() => selectedTool && handleSelectModel(selectedTool, model.internalId)}
      >
        {appliedPulse && appliedPulse.id === model.internalId && (
          <ModelCardPulse key={appliedPulse.nonce} />
        )}
        {/* Left: Radio + Icon */}
        <div className="relative z-10 flex items-center gap-3 flex-shrink-0">
          <div
            className={`w-4 h-4 rounded-full border-2 relative ${
              isSelected ? 'border-cyber-accent' : 'border-cyber-border'
            }`}
          >
            {isSelected && (
              <div className="w-2 h-2 rounded-full bg-cyber-accent absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
            )}
          </div>
          {iconSrc ? (
            <img
              src={iconSrc}
              alt=""
              className="w-6 h-6"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          ) : isLocalServer ? (
            <div className="w-6 h-6 flex items-center justify-center text-cyber-accent">
              <ServerIcon size={22} />
            </div>
          ) : (
            <div className="w-6 h-6 flex items-center justify-center text-cyber-text">
              <BoxIcon size={22} />
            </div>
          )}
        </div>

        {/* Right: Two-row layout */}
        <div className="relative z-10 flex-1 min-w-0 flex flex-col justify-center min-h-[2.5rem] py-0.5">
          <div className="flex items-center gap-2">
            <div className="text-sm font-bold truncate leading-none flex-1 min-w-0">
              {model.name || 'Untitled Model'}
            </div>
            {showSwitcher && (
              <span
                className="text-[10px] font-mono cursor-pointer select-none flex-shrink-0 transition-colors text-cyber-text-muted/60 hover:text-cyber-text"
                onClick={(e) => {
                  e.stopPropagation();
                  const newProtocol = currentProtocol === 'openai' ? 'anthropic' : 'openai';
                  setModelProtocolSelection((prev) => ({
                    ...prev,
                    [model.internalId]: newProtocol,
                  }));
                }}
              >
                {currentProtocol === 'openai' ? 'OpenAI' : 'Anthropic'}{' '}
                <span className="text-[8px]">⇄</span>
              </span>
            )}
          </div>
          <div className="text-[10px] text-cyber-text-secondary truncate leading-tight mt-1 opacity-70">
            {apiPath}
          </div>
        </div>
      </div>
    );
  };

  // Official-endpoint card — first item, like cc-switch's "Claude Official"
  const official = selectedTool ? getOfficialEndpoint(selectedTool) : undefined;
  const officialSentinel = selectedTool ? officialModelSentinel(selectedTool) : '';
  const isOfficialPending = !!(selectedTool && toolModelConfig[selectedTool] === officialSentinel);

  const renderOfficialCard = (ep: OfficialEndpoint) => {
    const apiPath = (() => {
      try {
        const url = new URL(
          ep.protocol === 'anthropic' ? ep.anthropicUrl || ep.baseUrl : ep.baseUrl
        );
        const path = url.pathname === '/' ? '' : url.pathname;
        return url.hostname + path;
      } catch {
        return ep.baseUrl;
      }
    })();

    // Use provider icon (Claude/OpenAI etc.) based on official endpoint name
    const iconSrc = getModelIcon(ep.name, ep.modelId);

    return (
      <div
        className={`relative overflow-hidden p-3 rounded cursor-pointer transition-colors mb-2 flex items-center gap-3 border bg-cyber-surface ${
          isOfficialPending ? 'border-cyber-accent' : 'border-transparent hover:bg-cyber-elevated'
        }`}
        onClick={() => selectedTool && handleSelectModel(selectedTool, officialSentinel)}
      >
        {appliedPulse && appliedPulse.id === officialSentinel && (
          <ModelCardPulse key={appliedPulse.nonce} />
        )}
        <div className="relative z-10 flex items-center gap-3 flex-shrink-0">
          <div
            className={`w-4 h-4 rounded-full border-2 relative ${
              isOfficialPending ? 'border-cyber-accent' : 'border-cyber-border'
            }`}
          >
            {isOfficialPending && (
              <div className="w-2 h-2 rounded-full bg-cyber-accent absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
            )}
          </div>
          {iconSrc ? (
            <img
              src={iconSrc}
              alt=""
              className="w-6 h-6"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          ) : (
            <div className="w-6 h-6 rounded bg-cyber-text/15 flex items-center justify-center text-cyber-text">
              <BoxIcon size={14} />
            </div>
          )}
        </div>
        <div className="relative z-10 flex-1 min-w-0 flex flex-col justify-center min-h-[2.5rem] py-0.5">
          <div className="flex items-center gap-2">
            <div className="text-sm font-bold truncate leading-none flex-1 min-w-0">{ep.name}</div>
            <span className="text-xs font-mono text-cyber-text-secondary/60 flex-shrink-0 pointer-events-none select-none">
              {t('agent.restore')}
            </span>
          </div>
          <div className="text-[10px] text-cyber-text-secondary truncate leading-tight mt-1 opacity-70">
            {apiPath}
          </div>
        </div>
      </div>
    );
  };

  // Fully empty: no local models, no cloud models, no official endpoint.
  // Show only the centered placeholder — the "select model for X" heading
  // would be misleading when there's nothing to select anyway.
  const isEmpty = cloudModels.length === 0 && !official && localModels.length === 0;
  if (isEmpty) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-center">
        <BoxIcon size={28} className="text-cyber-text opacity-25" />
        <p className="text-base text-cyber-text-secondary font-mono leading-relaxed">
          {t('agent.noModelsTitle')}
          <br />
          {t('agent.noModelsHintPre')}{' '}
          <span className="text-cyber-text font-bold">{t('nav.modelNexus')}</span>{' '}
          {t('agent.noModelsHintPost')}
        </p>
      </div>
    );
  }

  return (
    <>
      {/* Local models area */}
      {localModels.length > 0 && (
        <div className="mb-4">
          <div className="text-xs text-cyber-accent/80 mb-2">{t('agent.myLocalModel')}:</div>
          {localModels.map(renderModelCard)}
        </div>
      )}
      {/* Cloud models area — official endpoint goes first if registered */}
      <div className="space-y-2">
        {official && renderOfficialCard(official)}
        {cloudModels.map(renderModelCard)}
      </div>
    </>
  );
};

// A single routing toggle: label + switch + themed help glyph with an
// interactive tooltip. Used for the Codex / Claude-Desktop "API Router"
// toggle and the Codex-only "Responses" toggle. The tooltip stays open while
// the pointer is over the glyph OR the tooltip itself.
interface RoutingToggleProps {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}

function RoutingToggle({ label, hint, checked, onChange }: RoutingToggleProps) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear any pending close timer on unmount so it can't fire after teardown.
  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    []
  );

  const showTip = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  };
  // Small grace delay so moving the pointer from "?" across the gap into the
  // tooltip doesn't dismiss it.
  const scheduleHide = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 160);
  };

  return (
    <div className="flex items-center">
      <span className="text-xs text-cyber-text-secondary mr-2 whitespace-nowrap">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors outline-none focus-visible:ring-2 focus-visible:ring-cyber-accent mr-2 ${
          checked ? 'bg-cyber-accent' : 'bg-cyber-border'
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-all duration-200 ${
            checked ? 'translate-x-[18px] shadow-[0_1px_2px_rgba(0,0,0,0.35)]' : 'translate-x-1'
          }`}
        />
      </button>
      {/* Help glyph — themed, interactive tooltip (not the native browser one).
          onMouseEnter/Leave on this wrapper covers both the glyph and the
          tooltip (a descendant), so the tooltip stays open while hovered. */}
      <span
        className="relative inline-flex items-center"
        onMouseEnter={showTip}
        onMouseLeave={scheduleHide}
      >
        <span
          aria-label={hint}
          className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-cyber-elevated font-sans text-xs font-medium leading-none text-cyber-text-secondary cursor-help select-none hover:bg-cyber-accent/15 hover:text-cyber-accent transition-colors"
        >
          ?
        </span>
        <span
          role="tooltip"
          className={`absolute right-0 top-full z-[100] mt-1.5 w-72 rounded border border-cyber-accent/40 bg-cyber-elevated px-3 py-2 text-[11px] leading-relaxed text-cyber-text shadow-cyber-card backdrop-blur-sm transition-opacity ${
            open ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
        >
          {/* Caret — rotated square poking up out of the tooltip's top edge. */}
          <span
            aria-hidden="true"
            className="absolute -top-1 right-2 h-2 w-2 rotate-45 border-l border-t border-cyber-accent/40 bg-cyber-elevated"
          />
          {hint}
        </span>
      </span>
    </div>
  );
}

// ===== Right Panel (config panel with tabs) =====

export const AppManagerPanel: React.FC = () => {
  const { t } = useI18n();
  const {
    selectedToolData,
    selectedTool,
    userModels,
    toolModelConfig,
    handleSelectModel,
    modelProtocolSelection,
    setModelProtocolSelection,
    appliedPulse,
    codexResponsesPassthrough,
    setCodexResponsesPassthrough,
    codexWebSearch,
    setCodexWebSearch,
    claudeDesktopRelayMode,
    setClaudeDesktopRelayMode,
    claudeCodeRelayMode,
    setClaudeCodeRelayMode,
    claude1mMode,
    setClaude1mMode,
  } = useAppManager();

  // API Router ("relay-mode") toggle: shown for Claude Desktop AND Claude Code
  // (each binds its own relay flag). Codex CLI / ChatGPT desktop instead show the
  // Responses + Web Search toggles below. All of these toggles are
  // independent — there is no mutual exclusion among them.
  const isCodexApp = selectedTool === 'codex' || selectedTool === 'chatgptdesktop';
  const isClaudeDesktopApp = selectedTool === 'claudedesktop';
  const isClaudeCodeApp = selectedTool === 'claudecode';
  // Codex dropped the API Router toggle (it has Web Search now); relay is shown
  // for Claude Desktop + Claude Code, each binding its own flag.
  const showRelayToggle = isClaudeDesktopApp || isClaudeCodeApp;
  const showWebSearchToggle = isCodexApp;
  const showResponsesToggle = isCodexApp;
  const relayModeValue = isClaudeDesktopApp ? claudeDesktopRelayMode : claudeCodeRelayMode;
  const setRelayModeValue = isClaudeDesktopApp ? setClaudeDesktopRelayMode : setClaudeCodeRelayMode;
  // 1M-context toggle: Claude Code ONLY, and only once API Router is on. Hidden
  // in bridge mode (bridge writes no model id — CC's built-in claude-* ids
  // already budget the full window, so [1m] would be moot) and for Claude
  // Desktop (its 1M support comes from the backend profile in bridge mode).
  const show1mToggle = isClaudeCodeApp && claudeCodeRelayMode;

  return (
    <>
      {/* Header */}
      <div className="p-2 flex items-center justify-between bg-transparent">
        <div className="flex gap-1">
          <span className="px-3 py-1.5 text-xs font-bold text-cyber-text">
            {t('agent.modelsTab')}
          </span>
        </div>
        {selectedToolData && (
          <span className="text-[10px] text-cyber-text">{selectedToolData.name}</span>
        )}
      </div>

      {/* Toggle row: mounted when ANY toggle applies — Codex shows the
          Responses + Web Search toggles; Claude Desktop and Claude Code show the
          API Router toggle, and Claude Code additionally shows a 1M toggle when
          API Router is on. Each toggle inside is INDIVIDUALLY gated and binds
          to the flag for the selected app (relayModeValue / setRelayModeValue
          resolve per-app), so no cross-wiring between Codex / Claude Desktop /
          Claude Code. For apps with no toggles nothing renders and the model
          list below claims the space — the user preferred no reserved gap when
          toggles are absent. */}
      {(showResponsesToggle || showWebSearchToggle || showRelayToggle || show1mToggle) && (
        <div className="px-3 h-9 flex items-center gap-2">
          {showResponsesToggle && (
            <RoutingToggle
              key="responses"
              label={t('agent.codexResponsesLabel')}
              hint={t('agent.codexResponsesHint')}
              checked={codexResponsesPassthrough}
              onChange={setCodexResponsesPassthrough}
            />
          )}
          {showWebSearchToggle && (
            <RoutingToggle
              key="websearch"
              label={t('agent.codexWebSearchLabel')}
              hint={t('agent.codexWebSearchHint')}
              checked={codexWebSearch}
              onChange={setCodexWebSearch}
            />
          )}
          {showRelayToggle && (
            <RoutingToggle
              key="relay"
              label={t('agent.codexRelayLabel')}
              hint={t('agent.codexRelayHint')}
              checked={relayModeValue}
              onChange={setRelayModeValue}
            />
          )}
          {show1mToggle && (
            <RoutingToggle
              key="1m"
              label="1M"
              hint={t('agent.claude1mHint')}
              checked={claude1mMode}
              onChange={setClaude1mMode}
            />
          )}
        </div>
      )}

      <div className="flex-1 p-2 overflow-y-auto">
        {selectedToolData ? (
          // Not installed yet — no model to configure; the bottom bar's
          // "一键安装" already covers the action, so just state the state.
          !selectedToolData.installed ? (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-center">
              <BoxIcon size={28} className="text-cyber-text opacity-25" />
              <p className="text-base text-cyber-text-secondary font-mono leading-relaxed">
                {t('aiDesktop.notInstalled')}
              </p>
            </div>
          ) : selectedToolData.noModelConfig ? (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-center">
              <BoxIcon size={28} className="text-cyber-text opacity-25" />
              <p className="text-base text-cyber-text-secondary font-mono leading-relaxed">
                {t('agent.noModelConfig')}
              </p>
            </div>
          ) : (
            <div className="space-y-2 h-full">
              <ModelListSection
                selectedToolData={selectedToolData}
                userModels={userModels}
                toolModelConfig={toolModelConfig}
                selectedTool={selectedTool}
                handleSelectModel={handleSelectModel}
                modelProtocolSelection={modelProtocolSelection}
                setModelProtocolSelection={setModelProtocolSelection}
                appliedPulse={appliedPulse}
                t={t}
              />
            </div>
          )
        ) : (
          <div className="h-full flex items-center justify-center">
            <p className="text-cyber-text-secondary text-center">{t('agent.selectTool')}</p>
          </div>
        )}
      </div>
    </>
  );
};

// ===== Bottom Bar (launch area) =====

export const AppManagerBottom: React.FC = () => {
  const { t } = useI18n();
  const {
    selectedTool,
    selectedToolData,
    toolModelConfig,
    launchAfterApply,
    setLaunchAfterApply,
    isLaunching,
    agreedConfigPolicy,
    setAgreedConfigPolicy,
    handleLaunch,
    onGoToMother,
  } = useAppManager();

  const noModelConfig = !!selectedToolData?.noModelConfig;
  // An uninstalled tool flips the primary action to "一键安装" — one click
  // walks the user to the Install & Repair (Mother) page prefilled with the
  // install prompt. Model config / launch are meaningless until the tool is
  // actually on the machine.
  const isUninstalled = !!selectedToolData && !selectedToolData.installed;
  const hasModelSelected = !!(selectedTool && toolModelConfig[selectedTool]);
  // What will a click actually do?
  //  - "Apply" runs only when the user picked a model AND agreed to the config-write policy.
  //  - "Launch" runs whenever launchAfterApply is on, or unconditionally for desktop/no-config apps.
  // Many tools already work out of the box, so launching without picking a model must stay enabled —
  // forcing model selection just to start a CLI was the long-standing bug.
  const willApply = !noModelConfig && agreedConfigPolicy && hasModelSelected;
  const willLaunch = launchAfterApply || noModelConfig;
  const buttonDisabled =
    !selectedToolData || isLaunching || (!isUninstalled && !willApply && !willLaunch);

  // Uninstalled → install flow; otherwise the existing launch/apply flow.
  const handlePrimaryClick = () => {
    if (isUninstalled && selectedToolData) {
      onGoToMother(selectedTool!, selectedToolData.displayName || selectedToolData.name);
      return;
    }
    void handleLaunch();
  };

  return (
    <div className="flex-shrink-0 flex flex-col mt-2">
      <div className="mx-2 border-t border-cyber-border"></div>
      <div className="flex items-center justify-end gap-8 px-6 py-5">
        {/* Page-aware hint copy: AppManager warns against closing EchoBird mid-
            session (Codex / Claude config swap stays applied while we run);
            "我的AI项目" instead tells the user to crib from Reversi/Translator
            models.json when Vibe-Coding their own AI project. */}
        <PageAwareHint />
        {/* Launch button */}
        {/* Launch button */}
        <button
          onClick={handlePrimaryClick}
          disabled={buttonDisabled}
          className={`w-64 h-14 text-lg font-bold font-mono tracking-widest transition-colors flex-shrink-0 rounded-lg cjk-btn border shadow-lg ${
            buttonDisabled
              ? 'bg-cyber-border text-cyber-text-secondary border-transparent shadow-none cursor-not-allowed'
              : 'bg-cyber-accent text-white border-cyber-accent hover:bg-cyber-accent-secondary hover:border-cyber-accent-secondary shadow-cyber-accent/30'
          }`}
        >
          {isUninstalled
            ? t('btn.installOneClick')
            : willLaunch
              ? t('btn.launchApp')
              : t('btn.modifyOnly')}
        </button>
        {/* Checkboxes — for tools that don't support model config (desktop apps,
                    IDE plugins) or aren't installed yet the boxes stay visible but go
                    gray + un-clickable, so the layout doesn't shift and the user
                    understands why the toggles are inert. */}
        <div
          className={`flex flex-col gap-2 ${
            noModelConfig || isUninstalled ? 'opacity-40 pointer-events-none' : ''
          }`}
        >
          {/* Apply & Launch checkbox */}
          <label
            className={`flex items-center gap-2 select-none ${noModelConfig ? 'cursor-not-allowed' : 'cursor-pointer'}`}
            onClick={() => {
              if (!noModelConfig) setLaunchAfterApply(!launchAfterApply);
            }}
          >
            <div
              className={`w-3.5 h-3.5 border flex items-center justify-center transition-all flex-shrink-0 ${
                launchAfterApply
                  ? 'border-cyber-border bg-cyber-text/20'
                  : 'border-cyber-border hover:border-cyber-text-muted'
              }`}
            >
              {launchAfterApply && (
                <svg
                  width="8"
                  height="8"
                  viewBox="0 0 10 10"
                  fill="none"
                  className="text-cyber-text"
                >
                  <path
                    d="M2 5L4 7L8 3"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </div>
            <span
              className={`text-xs font-mono transition-colors ${launchAfterApply ? 'text-cyber-text' : 'text-cyber-text-secondary'}`}
            >
              {t('agent.applyAndLaunch')}
            </span>
          </label>
          {/* Config policy agreement */}
          <label
            className={`flex items-center gap-2 select-none ${noModelConfig ? 'cursor-not-allowed' : 'cursor-pointer'}`}
            onClick={() => {
              if (!noModelConfig) setAgreedConfigPolicy(!agreedConfigPolicy);
            }}
          >
            <div
              className={`w-3.5 h-3.5 border flex items-center justify-center transition-all flex-shrink-0 ${
                agreedConfigPolicy
                  ? 'border-cyber-border bg-cyber-text/20'
                  : 'border-cyber-border hover:border-cyber-text-muted'
              }`}
            >
              {agreedConfigPolicy && (
                <svg
                  width="8"
                  height="8"
                  viewBox="0 0 10 10"
                  fill="none"
                  className="text-cyber-text"
                >
                  <path
                    d="M2 5L4 7L8 3"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </div>
            <span
              className={`text-xs font-mono transition-colors ${agreedConfigPolicy ? 'text-cyber-text' : 'text-cyber-text-secondary'}`}
            >
              {t('agent.appliedVia')}
            </span>
          </label>
        </div>
      </div>
    </div>
  );
};

// Orange instructional copy shown at the bottom-left of the launch row.
// Branches on activePage so the same AppManagerBottom can serve both
// "应用管理" and "我的AI项目" without duplicating the rest of the row.
const PageAwareHint: React.FC = () => {
  const { t } = useI18n();
  const activePage = useNavigationStore((s) => s.activePage);
  const key = activePage === 'myProjects' ? 'hint.myProjects' : 'hint.devInvite';
  return <div className="flex-1 text-[15px] font-medium text-cyber-accent">{t(key)}</div>;
};

// ===== Apply Error Modal =====

export const AppManagerErrorModal: React.FC = () => {
  const { t } = useI18n();
  const { applyError, setApplyError } = useAppManager();

  if (!applyError) return null;

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => setApplyError(null)}
      />
      <div className="relative w-[360px] max-w-[90vw] border border-red-500/40 bg-cyber-surface shadow-2xl rounded-xl overflow-hidden">
        <div className="h-[2px] w-full bg-red-500/60" />
        <div className="px-5 pt-4 pb-2 flex items-center gap-2">
          <svg
            className="w-4 h-4 text-red-400 flex-shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span className="text-sm font-mono font-bold tracking-wider text-red-400">
            API Key Warning
          </span>
        </div>
        <div className="px-5 pb-5">
          <p className="text-xs text-cyber-text-secondary leading-relaxed font-mono">
            {applyError}
          </p>
        </div>
        <div className="flex border-t border-cyber-border">
          <button
            onClick={() => setApplyError(null)}
            className="flex-1 px-4 py-2.5 text-xs font-mono font-bold tracking-wider text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-all"
          >
            {t('common.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
};
