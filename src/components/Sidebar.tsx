// Sidebar navigation component
import { useRef } from 'react';
import {
  Box,
  Server,
  FolderHeart,
  Trophy,
  Newspaper,
  Monitor,
  Waypoints,
  Sparkles,
  RefreshCw,
  Users,
  Mic,
} from 'lucide-react';
import { NavItem } from './NavItem';
import { RoutingToggle } from './RoutingToggle';
import { useToast } from './Toast';
import { useI18n } from '../hooks/useI18n';
import type { TKey } from '../i18n';
import type { SmartRouterConfig } from '../api/smartRouter';
import { useLocalServerStatusStore } from '../stores/localServerStatusStore';
import { useVoiceInputStore, voiceBusy } from '../stores/voiceInputStore';
import { BirdEasterEgg } from './BirdEasterEgg';

declare const __APP_EDITION__: string;
const isFullEdition = __APP_EDITION__ === 'full';

export type PageType =
  | 'models'
  | 'accounts'
  | 'freeModels'
  | 'apps'
  | 'aiNews'
  | 'aiCareer'
  | 'voice'
  | 'myProjects'
  | 'localLlm'
  | 'mother'
  | 'feedback';

interface SidebarProps {
  activePage: PageType;
  onPageChange: (page: PageType) => void;
  agentRunning?: boolean;
  smartRouterGroups: ReadonlyArray<Pick<SmartRouterConfig, 'candidateIds' | 'groupEnabled'>>;
  smartRouterEnabled: boolean;
  smartRouterTogglePending: boolean;
  onSmartRouterChange: (enabled: boolean) => void;
  updateAvailable?: string | null;
  onSettingsClick?: () => void;
}

export const Sidebar = ({
  activePage,
  onPageChange,
  agentRunning = false,
  smartRouterGroups,
  smartRouterEnabled,
  smartRouterTogglePending,
  onSmartRouterChange,
  updateAvailable = null,
  onSettingsClick,
}: SidebarProps) => {
  const { t } = useI18n();
  const { showToast } = useToast();
  const sidebarRef = useRef<HTMLElement>(null);
  const perchRef = useRef<HTMLDivElement>(null);
  const serverRunning = useLocalServerStatusStore((state) => state.running);
  const voiceEnabled = useVoiceInputStore(
    (state) => state.snapshot?.config.shortcutEnabled ?? false
  );
  const hasVoiceChannels = useVoiceInputStore(
    (state) => (state.snapshot?.config.channels.length ?? 0) > 0
  );
  const voicePending = useVoiceInputStore((state) => state.saving || state.pending);
  const voiceDisabled = useVoiceInputStore(
    (state) => !state.snapshot || voiceBusy(state.snapshot.phase)
  );
  const saveVoice = useVoiceInputStore((state) => state.save);
  const showSmartRouterToggle = smartRouterGroups.some((router) => router.candidateIds.length > 0);

  return (
    <nav ref={sidebarRef} className="relative w-64 flex flex-col px-6 pb-6">
      <div className="mb-7 flex-shrink-0 flex items-center gap-2 overflow-hidden">
        <BirdEasterEgg sidebarRef={sidebarRef} perchRef={perchRef} />
        <span className="brand-mark flex-shrink-0 text-cyber-text">{t('app.name')}</span>
        {updateAvailable && (
          <button
            onClick={onSettingsClick}
            className="flex-shrink-0 text-[11px] font-mono text-red-400 hover:opacity-70 transition-opacity animate-pulse leading-none"
          >
            {t('settings.updates')}
          </button>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto page-scroll space-y-5 text-[15px]">
        <NavItem
          icon={<Monitor size={20} />}
          label={t('nav.appManager')}
          active={activePage === 'apps'}
          onClick={() => onPageChange('apps')}
        />
        <NavItem
          icon={<Box size={20} />}
          label={t('nav.modelNexus')}
          active={activePage === 'models'}
          onClick={() => onPageChange('models')}
        />
        <NavItem
          icon={<Users size={20} />}
          label={t('nav.accountCenter')}
          active={activePage === 'accounts'}
          onClick={() => onPageChange('accounts')}
        />
        <NavItem
          icon={<Waypoints size={20} />}
          label={t('nav.freeModels')}
          active={activePage === 'freeModels'}
          onClick={() => onPageChange('freeModels')}
        />
        <NavItem
          icon={<Mic size={20} />}
          label={t('voice.input')}
          active={activePage === 'voice'}
          onClick={() => onPageChange('voice')}
        />
        <NavItem
          icon={<Sparkles size={20} />}
          label={t('nav.motherAgent')}
          active={activePage === 'mother'}
          onClick={() => onPageChange('mother')}
          trailing={
            agentRunning && (
              <RefreshCw size={14} aria-hidden="true" className="animate-spin text-cyber-accent" />
            )
          }
        />
        {/* Divider — primary actions above; news, career and project tools below */}
        <div ref={perchRef} className="border-t border-cyber-border/50" />
        <NavItem
          icon={<Newspaper size={20} />}
          label={t('nav.aiNews')}
          active={activePage === 'aiNews'}
          onClick={() => onPageChange('aiNews')}
        />
        <NavItem
          icon={<Trophy size={20} />}
          label={t('nav.aiCareer')}
          active={activePage === 'aiCareer'}
          onClick={() => onPageChange('aiCareer')}
        />
        <NavItem
          icon={<FolderHeart size={20} />}
          label={t('nav.myProjects')}
          active={activePage === 'myProjects'}
          onClick={() => onPageChange('myProjects')}
        />
        {isFullEdition && (
          <NavItem
            icon={<Server size={20} />}
            label={t('nav.localServer')}
            active={activePage === 'localLlm'}
            onClick={() => onPageChange('localLlm')}
          />
        )}
      </div>

      <div className="flex-shrink-0 pt-4 text-[14px] text-cyber-text-secondary">
        <div className="space-y-2 text-[15px] font-medium">
          {hasVoiceChannels && (
            <div className="flex items-center gap-4 p-2">
              <span className="whitespace-nowrap">{t('voice.input')}</span>
              <RoutingToggle
                label={t('voice.enableInput')}
                hideLabel
                checked={voiceEnabled}
                disabled={voiceDisabled}
                pending={voicePending}
                onChange={async (enabled) => {
                  if (voiceDisabled || voicePending) return;
                  if (await saveVoice({ shortcutEnabled: enabled })) return;
                  const error = useVoiceInputStore.getState().error;
                  if (error)
                    showToast('error', error.startsWith('voice.') ? t(error as TKey) : error);
                }}
              />
            </div>
          )}
          {showSmartRouterToggle && (
            <div className="flex items-center gap-4 p-2">
              <span className="whitespace-nowrap">{t('nav.smartRouter')}</span>
              <RoutingToggle
                label={t('nav.smartRouter')}
                hideLabel
                checked={smartRouterEnabled}
                pending={smartRouterTogglePending}
                onChange={onSmartRouterChange}
              />
            </div>
          )}
        </div>
        {isFullEdition && serverRunning && (
          <div className="mt-1">
            {t('nav.localServer')}:{' '}
            <span className="text-cyber-accent font-semibold">{t('status.running')}</span>
          </div>
        )}
      </div>
    </nav>
  );
};
