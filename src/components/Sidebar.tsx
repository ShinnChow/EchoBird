// Sidebar navigation component
import { useState, useEffect } from 'react';
import {
  Box,
  Server,
  Newspaper,
  Star,
  Sparkles,
  FolderHeart,
  Trophy,
  Monitor,
  Download,
  Target,
} from 'lucide-react';
import { NavItem } from './NavItem';
import { useI18n } from '../hooks/useI18n';
import * as api from '../api/tauri';
import { useDocumentVisible } from '../hooks/useDocumentVisible';

declare const __APP_EDITION__: string;
const isFullEdition = __APP_EDITION__ === 'full';

export type PageType =
  | 'news'
  | 'projects'
  | 'skills'
  | 'models'
  | 'freeModels'
  | 'apps'
  | 'aiCareer'
  | 'myProjects'
  | 'localLlm'
  | 'mother'
  | 'feedback';

interface SidebarProps {
  activePage: PageType;
  onPageChange: (page: PageType) => void;
  agentRunning?: boolean;
  updateAvailable?: string | null;
  onSettingsClick?: () => void;
}

export const Sidebar = ({
  activePage,
  onPageChange,
  agentRunning: _agentRunning = false,
  updateAvailable = null,
  onSettingsClick,
}: SidebarProps) => {
  const { t } = useI18n();
  // Poll local model server status
  const [serverRunning, setServerRunning] = useState(false);
  const docVisible = useDocumentVisible();

  // Poll local model server status — pause when the window is hidden so a
  // backgrounded app doesn't poll IPC every 2s for hours. Resumes on focus.
  useEffect(() => {
    if (!isFullEdition || !docVisible) return;
    const check = async () => {
      try {
        const info = await api.getLlmServerInfo();
        const running = info?.running ?? false;
        setServerRunning((prev) => (prev === running ? prev : running));
      } catch {
        setServerRunning((prev) => (prev === false ? prev : false));
      }
    };
    check();
    const interval = setInterval(check, 2000);
    return () => clearInterval(interval);
  }, [docVisible]);

  return (
    <nav className="w-64 flex flex-col px-6 pb-6">
      <div className="mb-7 flex items-center gap-2 overflow-hidden">
        <img
          src="/brand/bird.png"
          alt=""
          aria-hidden="true"
          draggable={false}
          className="flex-shrink-0 h-7 w-7 select-none"
        />
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
      <div className="flex-1 space-y-5 text-[15px]">
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
          icon={<Target size={20} />}
          label={t('nav.freeModels')}
          active={activePage === 'freeModels'}
          onClick={() => onPageChange('freeModels')}
        />
        <NavItem
          icon={<Download size={20} />}
          label={t('nav.motherAgent')}
          active={activePage === 'mother'}
          onClick={() => onPageChange('mother')}
        />
        {/* Divider — the three primary actions sit above it; content pages below */}
        <div className="border-t border-cyber-border/50" />
        <NavItem
          icon={<Newspaper size={20} />}
          label={t('nav.news')}
          active={activePage === 'news'}
          onClick={() => onPageChange('news')}
        />
        <NavItem
          icon={<Star size={20} />}
          label={t('nav.projects')}
          active={activePage === 'projects'}
          onClick={() => onPageChange('projects')}
        />
        <NavItem
          icon={<Sparkles size={20} />}
          label={t('nav.skills')}
          active={activePage === 'skills'}
          onClick={() => onPageChange('skills')}
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

      {isFullEdition && (
        <div className="pt-4 text-[14px] text-cyber-text-secondary">
          {t('nav.localServer')}:{' '}
          {serverRunning ? (
            <span className="text-cyber-accent font-semibold">{t('status.running')}</span>
          ) : (
            <span className="text-cyber-text-muted">{t('status.offline')}</span>
          )}
        </div>
      )}
    </nav>
  );
};
