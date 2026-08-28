import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { open as shellOpen } from '@tauri-apps/plugin-shell';
import {
  Box,
  Check,
  CircleHelp,
  ExternalLink,
  KeyRound,
  Plus,
  RefreshCw,
  Route,
  X,
} from 'lucide-react';
import * as api from '../../api/tauri';
import type { FreeModelDirectory, FreeModelEntry } from '../../api/freeModels';
import { getModelIcon } from '../../components';
import { useI18n } from '../../hooks/useI18n';
import { useModelNexus } from '../ModelNexus/context';
import './FreeModels.css';

const NODE_COLUMN_GAP = 28;
const NODE_ROW_GAP = 56;
const HUB_TO_NODE_GAP = 72;
const HUB_ARROW_GAP = 4;
const HUB_ARROW_HEIGHT = 12;
const HUB_ARROW_LINE_GAP = 2;
const SCAN_STEP_MS = 230;
const SCAN_COMPLETE_MS = 320;

interface FreeModelsContextValue {
  catalog: FreeModelDirectory;
  models: FreeModelEntry[];
  customModels: RouteModelNode[];
  selectedIds: Set<string>;
  brokenIds: Set<string>;
  refreshing: boolean;
  scanProvider: string;
  scanProgress: number;
  refresh: () => Promise<void>;
  addSelectedModel: (model: RouteModelInput) => void;
  toggleSelected: (id: string) => void;
}

interface RouteModelInput {
  internalId: string;
  name: string;
  baseUrl: string;
  modelId: string;
}

interface RouteModelNode {
  id: string;
  provider: string;
  modelId: string;
}

interface FreeModelProviderGroup {
  id: string;
  name: string;
  baseUrl: string;
  docsUrl: string;
  models: FreeModelEntry[];
}

interface RoutePath {
  id: string;
  d: string;
  broken: boolean;
}

interface RouteArrow {
  x: number;
  y: number;
  broken: boolean;
}

const FreeModelsContext = createContext<FreeModelsContextValue | null>(null);
const emptyCatalog: FreeModelDirectory = {
  version: 1,
  updatedAt: '',
  models: [],
};
const providerPriority = ['nvidia-nim', 'openrouter'];

function providerRank(model: FreeModelEntry): number {
  const rank = providerPriority.indexOf(model.providerId);
  return rank === -1 ? providerPriority.length : rank;
}

function groupModelsForScan(models: FreeModelEntry[]): FreeModelEntry[][] {
  const groups = new Map<string, FreeModelEntry[]>();
  models.forEach((model) => {
    const id = `${model.providerId}:${model.baseUrl}`;
    const group = groups.get(id);
    if (group) group.push(model);
    else groups.set(id, [model]);
  });
  return [...groups.values()].sort((left, right) => providerRank(left[0]) - providerRank(right[0]));
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function useFreeModels() {
  const value = useContext(FreeModelsContext);
  if (!value) throw new Error('useFreeModels must be used within FreeModelsProvider');
  return value;
}

function shortModelName(modelId: string): string {
  const tail = modelId.split('/').pop() || modelId;
  return tail.length > 27 ? `${tail.slice(0, 24)}…` : tail;
}

export function FreeModelsProvider({ children }: { children: ReactNode }) {
  const [catalog, setCatalog] = useState<FreeModelDirectory>(emptyCatalog);
  const [customModels, setCustomModels] = useState<RouteModelNode[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [brokenIds, setBrokenIds] = useState<Set<string>>(() => new Set());
  const [refreshing, setRefreshing] = useState(false);
  const [scanProvider, setScanProvider] = useState('');
  const [scanProgress, setScanProgress] = useState(0);
  const refreshInFlightRef = useRef(false);
  const models = catalog.models;

  const refresh = useCallback(async () => {
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    setCatalog(emptyCatalog);
    setScanProvider('');
    setScanProgress(0);
    setRefreshing(true);
    try {
      const remote = await api.getFreeModelDirectory();
      if (!remote) return;

      const groups = groupModelsForScan(remote.models);
      const revealedModels: FreeModelEntry[] = [];
      for (const [index, group] of groups.entries()) {
        setScanProvider(group[0]?.provider ?? '');
        await wait(SCAN_STEP_MS);
        revealedModels.push(...group);
        setCatalog({ ...remote, models: [...revealedModels] });
        setScanProgress((index + 1) / groups.length);
      }
      await wait(SCAN_COMPLETE_MS);
    } finally {
      refreshInFlightRef.current = false;
      setScanProvider('');
      setScanProgress(0);
      setRefreshing(false);
    }
  }, []);

  const addSelectedModel = useCallback(
    (model: RouteModelInput) => {
      const catalogModel = catalog.models.find(
        (entry) => entry.baseUrl === model.baseUrl && entry.modelId === model.modelId
      );
      const id = catalogModel?.id ?? `custom:${model.internalId}`;
      if (!catalogModel) {
        setCustomModels((current) => [
          ...current.filter((entry) => entry.id !== id),
          { id, provider: model.name, modelId: model.modelId },
        ]);
      }
      setSelectedIds((current) => new Set(current).add(id));
      setBrokenIds((current) => {
        if (!current.has(id)) return current;
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    },
    [catalog.models]
  );

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setBrokenIds((current) => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  }, []);

  return (
    <FreeModelsContext.Provider
      value={{
        catalog,
        models,
        customModels,
        selectedIds,
        brokenIds,
        refreshing,
        scanProvider,
        scanProgress,
        refresh,
        addSelectedModel,
        toggleSelected,
      }}
    >
      {children}
    </FreeModelsContext.Provider>
  );
}

export function FreeModelsTitleActions() {
  const { t } = useI18n();
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    if (!showHelp) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowHelp(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [showHelp]);

  return (
    <>
      <button
        type="button"
        onClick={() => setShowHelp(true)}
        className="flex items-center gap-1.5 text-sm font-mono px-3 py-1.5 border border-cyber-border rounded-button text-cyber-text hover:bg-cyber-text/10 transition-colors"
      >
        <CircleHelp size={13} />
        {t('freeModels.help')}
      </button>

      {showHelp && (
        <div className="fixed inset-0 z-[9998] flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setShowHelp(false)}
          />
          <div className="relative w-[520px] max-w-[90vw] border border-cyber-border/30 bg-cyber-surface shadow-2xl rounded-xl overflow-hidden">
            <div className="h-px w-full bg-cyber-border" />
            <button
              type="button"
              onClick={() => setShowHelp(false)}
              aria-label={t('btn.close')}
              className="absolute right-5 top-5 text-cyber-text-secondary hover:text-cyber-text transition-colors"
            >
              <X size={18} />
            </button>

            <div className="px-6 pt-6 pb-6 pr-14 space-y-4">
              <div className="flex gap-3">
                <Route size={18} className="mt-0.5 flex-shrink-0 text-cyber-accent" />
                <div>
                  <div className="text-sm font-semibold text-cyber-text">
                    {t('freeModels.help.routerTitle')}
                  </div>
                  <p className="mt-1 text-xs leading-5 text-cyber-text-secondary">
                    {t('freeModels.help.routerDesc')}
                  </p>
                </div>
              </div>

              <div className="h-px bg-cyber-border/60" />

              <div className="flex gap-3">
                <KeyRound size={18} className="mt-0.5 flex-shrink-0 text-cyber-accent" />
                <div>
                  <div className="text-sm font-semibold text-cyber-text">
                    {t('freeModels.help.useTitle')}
                  </div>
                  <ol className="mt-1 space-y-1.5 text-xs leading-5 text-cyber-text-secondary list-decimal list-inside">
                    <li>{t('freeModels.help.step1')}</li>
                    <li>{t('freeModels.help.step2')}</li>
                    <li>{t('freeModels.help.step3')}</li>
                  </ol>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowHelp(false)}
              className="w-full border-t border-cyber-border px-4 py-3 text-[14px] font-semibold text-cyber-text hover:bg-cyber-text/10 transition-colors"
            >
              {t('btn.close')}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export function FreeModelsMain() {
  const { t } = useI18n();
  const { models, customModels, selectedIds, brokenIds, toggleSelected } = useFreeModels();
  const selectedModels = useMemo(
    () => [...models, ...customModels].filter((model) => selectedIds.has(model.id)),
    [models, customModels, selectedIds]
  );
  const healthyCount = selectedModels.length - brokenIds.size;
  const stageRef = useRef<HTMLDivElement | null>(null);
  const hubRef = useRef<HTMLDivElement | null>(null);
  const nodeRefs = useRef(new Map<string, HTMLDivElement>());
  const [routePaths, setRoutePaths] = useState<RoutePath[]>([]);
  const [routeArrow, setRouteArrow] = useState<RouteArrow | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 1, height: 1 });

  const setNodeRef = useCallback((id: string, node: HTMLDivElement | null) => {
    if (node) nodeRefs.current.set(id, node);
    else nodeRefs.current.delete(id);
  }, []);

  const updatePaths = useCallback(() => {
    const stage = stageRef.current;
    const hub = hubRef.current;
    if (!stage || !hub) return;
    const stageBox = stage.getBoundingClientRect();
    const hubBox = hub.getBoundingClientRect();
    const endX = hubBox.left - stageBox.left + hubBox.width / 2;
    const endY = hubBox.bottom - stageBox.top;

    const entries = [...nodeRefs.current].map(([id, node]) => {
      const box = node.getBoundingClientRect();
      return {
        id,
        x: box.left - stageBox.left + box.width / 2,
        top: box.top - stageBox.top,
        bottom: box.bottom - stageBox.top,
      };
    });
    entries.sort((left, right) => left.top - right.top || left.x - right.x);

    const rows: (typeof entries)[] = [];
    for (const entry of entries) {
      const row = rows.find((candidate) => Math.abs(candidate[0].top - entry.top) < 12);
      if (row) row.push(entry);
      else rows.push([entry]);
    }

    const nextPaths: RoutePath[] = [];
    const firstRow = rows[0];
    let nextArrow: RouteArrow | null = null;
    if (firstRow) {
      const arrowY = endY + HUB_ARROW_GAP;
      const lineEndY = arrowY + HUB_ARROW_HEIGHT + HUB_ARROW_LINE_GAP;
      if (firstRow.length === 1) {
        const entry = firstRow[0];
        const broken = brokenIds.has(entry.id);
        nextPaths.push({
          id: entry.id,
          broken,
          d: `M ${entry.x} ${entry.top - 3} V ${lineEndY}`,
        });
        nextArrow = { x: endX, y: arrowY, broken };
      } else {
        const busY = endY + (firstRow[0].top - endY) / 2;
        const firstX = firstRow[0].x;
        const lastX = firstRow[firstRow.length - 1].x;
        const busSegments = [];
        if (firstX < endX - 1) busSegments.push(`M ${firstX} ${busY} H ${endX}`);
        if (lastX > endX + 1) busSegments.push(`M ${lastX} ${busY} H ${endX}`);
        const allBroken = firstRow.every((entry) => brokenIds.has(entry.id));
        if (busSegments.length > 0) {
          nextPaths.push({
            id: 'hub-bus',
            broken: allBroken,
            d: busSegments.join(' '),
          });
        }
        nextPaths.push({
          id: 'hub-trunk',
          broken: allBroken,
          d: `M ${endX} ${busY} V ${lineEndY}`,
        });
        nextArrow = { x: endX, y: arrowY, broken: allBroken };
        firstRow.forEach((entry) => {
          nextPaths.push({
            id: entry.id,
            broken: brokenIds.has(entry.id),
            d: `M ${entry.x} ${entry.top - 3} V ${busY}`,
          });
        });
      }
    }

    rows.slice(1).forEach((row, rowIndex) => {
      const parentRow = rows[rowIndex];
      row.forEach((entry) => {
        const parent = parentRow.reduce((closest, candidate) =>
          Math.abs(candidate.x - entry.x) < Math.abs(closest.x - entry.x) ? candidate : closest
        );
        const bridgeY = parent.bottom + (entry.top - parent.bottom) / 2;
        nextPaths.push({
          id: entry.id,
          broken: brokenIds.has(entry.id),
          d:
            Math.abs(entry.x - parent.x) < 1
              ? `M ${entry.x} ${entry.top - 3} V ${parent.bottom + 3}`
              : `M ${entry.x} ${entry.top - 3} V ${bridgeY} H ${parent.x} V ${parent.bottom + 3}`,
        });
      });
    });
    setCanvasSize({ width: stageBox.width, height: stageBox.height });
    setRoutePaths(nextPaths);
    setRouteArrow(nextArrow);
  }, [brokenIds]);

  useLayoutEffect(() => {
    const frame = requestAnimationFrame(updatePaths);
    const stage = stageRef.current;
    if (!stage) return () => cancelAnimationFrame(frame);
    const observer = new ResizeObserver(updatePaths);
    observer.observe(stage);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [selectedModels, updatePaths]);

  return (
    <div className="free-model-router h-full min-h-[620px] px-2 py-1">
      <div ref={stageRef} className="relative h-full min-h-[550px] pt-6 overflow-hidden">
        <svg
          className="absolute inset-0 z-0 h-full w-full pointer-events-none"
          viewBox={`0 0 ${canvasSize.width} ${canvasSize.height}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {routePaths.map((path) => (
            <path
              key={path.id}
              d={path.d}
              className={path.broken ? 'free-model-route-path is-broken' : 'free-model-route-path'}
            />
          ))}
          {routeArrow && (
            <path
              d={`M ${routeArrow.x} ${routeArrow.y} L ${routeArrow.x - 6} ${routeArrow.y + HUB_ARROW_HEIGHT} H ${routeArrow.x + 6} Z`}
              className={
                routeArrow.broken ? 'free-model-route-arrow is-broken' : 'free-model-route-arrow'
              }
            />
          )}
        </svg>

        <div
          ref={hubRef}
          className={`free-model-router-hub relative z-10 mx-auto w-[min(270px,80%)] min-h-[118px] rounded-2xl flex flex-col items-center justify-center text-center px-5 ${
            healthyCount > 0 ? 'is-running' : selectedModels.length > 0 ? 'is-unavailable' : ''
          }`}
        >
          <div className="text-xl font-semibold text-cyber-text">
            {t('freeModels.router.title')}
          </div>
          <div className="mt-2 text-[11px] font-mono free-model-router-state">127.0.0.1:xxx/v1</div>
        </div>

        {selectedModels.length === 0 ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center text-center pointer-events-none">
            <div>
              <div className="font-medium text-sm text-cyber-text">
                {t('freeModels.router.emptyTitle')}
              </div>
              <div className="mt-2 text-xs text-cyber-text-muted">
                {t('freeModels.router.emptyDesc')}
              </div>
            </div>
          </div>
        ) : (
          <>
            <div
              className="free-model-node-grid relative z-10"
              style={{
                gridTemplateColumns:
                  selectedModels.length >= 4
                    ? 'repeat(4, minmax(0, 1fr))'
                    : `repeat(${selectedModels.length}, minmax(140px, 190px))`,
                columnGap: NODE_COLUMN_GAP,
                rowGap: NODE_ROW_GAP,
                marginTop: HUB_TO_NODE_GAP,
              }}
            >
              {selectedModels.map((model) => {
                const broken = brokenIds.has(model.id);
                return (
                  <div
                    key={model.id}
                    ref={(node) => setNodeRef(model.id, node)}
                    className={`free-model-route-node group relative min-h-[72px] rounded-lg p-3 pr-10 text-left flex flex-col justify-center ${
                      broken ? 'is-broken' : ''
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSelected(model.id)}
                      className="absolute right-2 top-2 h-7 w-7 rounded-md flex items-center justify-center text-cyber-text-muted opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto focus-visible:opacity-100 focus-visible:pointer-events-auto hover:text-cyber-text hover:bg-cyber-text/10 transition-all"
                      aria-label={`${t('btn.remove')} ${shortModelName(model.modelId)}`}
                    >
                      <X size={14} />
                    </button>
                    <div className="text-xs font-semibold text-cyber-text truncate">
                      {shortModelName(model.modelId)}
                    </div>
                    <div className="mt-1 text-[10px] text-cyber-text-muted truncate">
                      {model.provider}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function FreeModelProviderRow({
  group,
  selected,
  onAdd,
}: {
  group: FreeModelProviderGroup;
  selected: boolean;
  onAdd: () => void;
}) {
  const { t } = useI18n();
  const iconSrc = getModelIcon(group.name, '');
  const hostname = (() => {
    try {
      return new URL(group.baseUrl).hostname;
    } catch {
      return group.baseUrl;
    }
  })();
  const openDocs = () => shellOpen(group.docsUrl).catch(() => window.open(group.docsUrl, '_blank'));

  return (
    <div className="free-model-provider-enter relative flex items-stretch rounded overflow-hidden bg-cyber-surface">
      <button
        type="button"
        onClick={onAdd}
        aria-label={`${t('freeModels.addToRouter')}: ${group.name}`}
        aria-pressed={selected}
        className="group/left flex-1 min-h-[64px] bg-gradient-to-r from-transparent to-transparent hover:from-cyber-text/15 hover:to-transparent transition-[background-image] duration-200"
      />
      <button
        type="button"
        onClick={openDocs}
        aria-label={`${t('freeModels.docs')}: ${group.name}`}
        className="group/right flex-1 min-h-[64px] bg-gradient-to-l from-transparent to-transparent hover:from-cyber-text/15 hover:to-transparent transition-[background-image] duration-200"
      />

      <div className="pointer-events-none absolute inset-0 flex items-center gap-3 px-3">
        {selected ? (
          <Check
            size={22}
            strokeWidth={2.5}
            className="flex-shrink-0 text-cyber-accent group-hover/left:scale-110 transition-all"
          />
        ) : (
          <Plus
            size={22}
            strokeWidth={2.5}
            className="flex-shrink-0 text-cyber-text-muted group-hover/left:text-cyber-text group-hover/left:scale-110 transition-all"
          />
        )}
        <div className="flex-shrink-0">
          {iconSrc ? (
            <img
              src={iconSrc}
              alt=""
              className="w-6 h-6"
              onError={(event) => {
                (event.target as HTMLImageElement).style.display = 'none';
              }}
            />
          ) : (
            <div className="w-6 h-6 flex items-center justify-center text-cyber-text">
              <Box size={22} />
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0 flex flex-col justify-center">
          <div className="text-sm font-bold truncate leading-none">{group.name}</div>
          <div className="text-[10px] text-cyber-text-secondary truncate leading-tight mt-1 opacity-70">
            {hostname}
          </div>
        </div>
        <ExternalLink
          size={18}
          strokeWidth={2.25}
          className="flex-shrink-0 text-cyber-text-muted group-hover/right:text-cyber-text group-hover/right:scale-110 transition-all"
        />
      </div>
    </div>
  );
}

export function FreeModelsPanel() {
  const { t } = useI18n();
  const { models, selectedIds, refreshing, scanProvider, scanProgress, refresh } = useFreeModels();
  const { setNewModelForm, setEditingModelId, setModelModalDestination, setShowAddModelModal } =
    useModelNexus();
  const providerGroups = useMemo(() => {
    const groups = new Map<string, FreeModelProviderGroup>();
    models.forEach((model) => {
      const id = `${model.providerId}:${model.baseUrl}`;
      const group = groups.get(id);
      if (group) group.models.push(model);
      else {
        groups.set(id, {
          id,
          name: model.provider,
          baseUrl: model.baseUrl,
          docsUrl: model.docsUrl,
          models: [model],
        });
      }
    });
    return [...groups.values()].sort((left, right) => {
      return providerRank(left.models[0]) - providerRank(right.models[0]);
    });
  }, [models]);

  const openProvider = useCallback(
    (group: FreeModelProviderGroup) => {
      const modelIds = group.models.map((model) => model.modelId);
      setNewModelForm({
        name: group.name,
        baseUrl: group.baseUrl,
        anthropicUrl: '',
        apiKey: '',
        modelId: modelIds[0] ?? '',
        modelIdOptions: modelIds,
      });
      setEditingModelId(null);
      setModelModalDestination('freeRouter');
      setShowAddModelModal(true);
    },
    [setEditingModelId, setModelModalDestination, setNewModelForm, setShowAddModelModal]
  );

  const openCustomModel = useCallback(() => {
    setNewModelForm({
      name: '',
      baseUrl: '',
      anthropicUrl: '',
      apiKey: '',
      modelId: '',
    });
    setEditingModelId(null);
    setModelModalDestination('freeRouter');
    setShowAddModelModal(true);
  }, [setEditingModelId, setModelModalDestination, setNewModelForm, setShowAddModelModal]);

  return (
    <div className="free-model-router h-full min-h-0 flex flex-col">
      <div className="p-2 flex items-center gap-2 bg-transparent">
        <button
          type="button"
          onClick={openCustomModel}
          className="flex-1 h-9 px-3 text-[14px] font-semibold border border-cyber-border rounded-button text-cyber-text-secondary hover:text-cyber-text hover:bg-cyber-text/10 transition-colors flex items-center justify-center gap-2"
        >
          <Plus size={14} />
          {t('freeModels.customAdd')}
        </button>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={refreshing}
          aria-label={t('freeModels.fetch')}
          className={`w-9 h-9 flex items-center justify-center border rounded-button transition-colors ${
            !refreshing
              ? 'border-cyber-border text-cyber-text hover:bg-cyber-text/10'
              : 'border-cyber-border text-cyber-text-muted cursor-not-allowed'
          }`}
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
        </button>
      </div>
      {refreshing && (
        <div className="px-2 pb-2">
          <div className="h-1 rounded-full overflow-hidden bg-cyber-border/30">
            <div
              className="free-model-scan-progress h-full rounded-full bg-cyber-accent"
              style={{ width: `${Math.max(scanProgress, 0.04) * 100}%` }}
            />
          </div>
          <div className="mt-2 text-[11px] text-cyber-text-secondary truncate">
            {scanProvider ? (
              <>
                {t('freeModels.scanning')}
                {scanProvider}
              </>
            ) : (
              <>
                {t('freeModels.scanConnecting')}
                <span className="free-model-scan-dots" aria-hidden="true">
                  <span>.</span>
                  <span>.</span>
                  <span>.</span>
                </span>
              </>
            )}
          </div>
        </div>
      )}
      <div className="flex-1 p-2 overflow-y-auto">
        {providerGroups.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            {!refreshing && (
              <button
                type="button"
                onClick={() => void refresh()}
                className="flex items-center gap-2 text-sm font-semibold px-3 py-2 border border-cyber-border rounded-button text-cyber-text hover:bg-cyber-text/10 transition-colors"
              >
                <RefreshCw size={13} />
                {t('freeModels.fetch')}
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {providerGroups.map((group) => (
              <FreeModelProviderRow
                key={group.id}
                group={group}
                selected={group.models.some((model) => selectedIds.has(model.id))}
                onAdd={() => openProvider(group)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
