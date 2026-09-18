import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { LocalTool, ModelConfig } from '../../api/types';
import type { TKey } from '../../i18n';
import { useNavigationStore } from '../../stores/navigationStore';
import { AppManagerContext, type AppManagerContextType } from './context';

vi.mock('../../components', () => ({
  EffortPulse: () => null,
  getModelIcon: () => null,
}));

const tool: LocalTool = {
  id: 'test-tool',
  name: 'Test Tool',
  category: 'Desktop',
  installed: true,
  apiProtocol: ['openai'],
};

const models: ModelConfig[] = [
  {
    internalId: 'cloud-model',
    name: 'Cloud Model',
    baseUrl: 'https://cloud.example/v1',
    apiKey: '',
  },
  {
    internalId: 'local-server',
    name: 'Local Model',
    baseUrl: 'http://127.0.0.1:1234/v1',
    apiKey: '',
  },
  {
    internalId: 'smart-router',
    name: 'Auto Router',
    baseUrl: 'http://127.0.0.1:53683/v1',
    apiKey: '',
  },
];

const labels: Partial<Record<TKey, string>> = {
  'agent.badge.smart': '智能',
  'agent.badge.local': '本地',
};

describe('ModelListSection', () => {
  it('renders smart, local, and cloud models as one ordered list with compact badges', async () => {
    vi.stubGlobal('__APP_EDITION__', 'full');
    const { ModelListSection } = await import('./AppManagerComponents');
    const markup = renderToStaticMarkup(
      <ModelListSection
        selectedToolData={tool}
        userModels={models}
        toolModelConfig={{}}
        selectedTool={tool.id}
        handleSelectModel={() => undefined}
        modelProtocolSelection={{}}
        setModelProtocolSelection={() => undefined}
        t={(key) => labels[key] ?? key}
      />
    );

    expect(markup).toContain('智能');
    expect(markup).toContain('本地');
    expect(markup.indexOf('Auto Router')).toBeLessThan(markup.indexOf('Local Model'));
    expect(markup.indexOf('Local Model')).toBeLessThan(markup.indexOf('Cloud Model'));
  });

  it.each(['codex', 'chatgptdesktop'])(
    'hides Chat Completions-only local endpoints from %s',
    async (toolId) => {
      vi.stubGlobal('__APP_EDITION__', 'full');
      const { ModelListSection } = await import('./AppManagerComponents');
      const markup = renderToStaticMarkup(
        <ModelListSection
          selectedToolData={{ ...tool, id: toolId }}
          userModels={models}
          toolModelConfig={{}}
          selectedTool={toolId}
          handleSelectModel={() => undefined}
          modelProtocolSelection={{}}
          setModelProtocolSelection={() => undefined}
          t={(key) => labels[key] ?? key}
        />
      );

      expect(markup).not.toContain('Auto Router');
      expect(markup).not.toContain('Local Model');
      expect(markup).not.toContain('OpenAI Official');
      expect(markup).toContain('Cloud Model');
    }
  );
});

describe('CodexAccountSection', () => {
  it('renders saved accounts with pending selection and current-state metadata', async () => {
    vi.stubGlobal('__APP_EDITION__', 'full');
    const { CodexAccountSection } = await import('./AppManagerComponents');
    const context: Partial<AppManagerContextType> = {
      codexAccounts: [
        {
          id: 'account-1',
          email: 'first@example.com',
          plan: 'prolite',
          quotaPercent: 32,
          quotaResetAt: 1_800_000_000,
          active: true,
        },
      ],
      selectedCodexAccountId: 'account-1',
      setSelectedCodexAccountId: () => {},
      isLoadingCodexAccounts: false,
      isAddingCodexAccount: false,
      codexOAuthRemainingSeconds: 0,
      refreshingCodexAccountId: null,
      addCodexAccount: async () => {},
      refreshCodexAccountQuota: async () => {},
      deleteCodexAccount: async () => {},
    };

    const markup = renderToStaticMarkup(
      <AppManagerContext.Provider value={context as AppManagerContextType}>
        <CodexAccountSection showDivider={false} />
      </AppManagerContext.Provider>
    );

    expect(markup).toContain('first@example.com');
    expect(markup).toContain('Pro 5X');
    expect(markup).toContain('32%');
    expect(markup).toContain('aria-checked="true"');
    expect(markup).toContain('agent.refreshAccount');
    expect(markup).not.toContain('role="tooltip"');
    expect(markup).not.toContain('border-b');
  });
});

describe('AppManager views', () => {
  const installedTool = { ...tool, id: 'installed-app', name: 'Installed App' };
  const uninstalledTool = {
    ...tool,
    id: 'uninstalled-app',
    name: 'Uninstalled App',
    installed: false,
  };

  const renderView = async (viewMode: 'desktop' | 'install', detectedTools: LocalTool[]) => {
    vi.stubGlobal('__APP_EDITION__', 'full');
    const { AppManagerMain } = await import('./AppManagerComponents');
    const context: Partial<AppManagerContextType> = {
      detectedTools,
      viewMode,
      isScanning: false,
      selectedTool: null,
      setSelectedTool: () => {},
      aiInstallableIds: ['uninstalled-app'],
    };
    return renderToStaticMarkup(
      <AppManagerContext.Provider value={context as AppManagerContextType}>
        <AppManagerMain />
      </AppManagerContext.Provider>
    );
  };

  it.each([
    ['desktop', 'Installed App', 'Uninstalled App'],
    ['install', 'Uninstalled App', 'Installed App'],
  ] as const)('%s shows only the matching apps', async (mode, visible, hidden) => {
    const markup = await renderView(mode, [installedTool, uninstalledTool]);
    expect(markup).toContain(`aria-label="${visible}"`);
    expect(markup).not.toContain(`aria-label="${hidden}"`);
  });

  it.each([
    ['desktop', [uninstalledTool], 'aiDesktop.emptyDesktop'],
    ['install', [installedTool], 'aiDesktop.emptyInstall'],
  ] as const)('%s explains an empty list', async (mode, tools, message) => {
    const markup = await renderView(mode, [...tools]);
    expect(markup).toContain(message);
  });
});

describe('PageAwareHint', () => {
  const renderHint = async (selectedTool: string | null) => {
    vi.stubGlobal('__APP_EDITION__', 'full');
    useNavigationStore.setState({ activePage: 'apps' });
    const { PageAwareHint } = await import('./AppManagerComponents');
    const context: Partial<AppManagerContextType> = {
      viewMode: 'desktop',
      selectedTool,
    };
    return renderToStaticMarkup(
      <AppManagerContext.Provider value={context as AppManagerContextType}>
        <PageAwareHint />
      </AppManagerContext.Provider>
    );
  };

  it.each(['claudedesktop', 'claudecode'])(
    'shows the keep-running reminder only for %s',
    async (toolId) => {
      const markup = await renderHint(toolId);
      expect(markup).toContain('hint.devInvite');
      expect(markup).not.toContain('hint.responsesRequired');
    }
  );

  it.each(['chatgptdesktop', 'codex'])(
    'shows the Responses compatibility reminder for %s',
    async (toolId) => {
      const markup = await renderHint(toolId);
      expect(markup).toContain('hint.responsesRequired');
      expect(markup).not.toContain('hint.devInvite');
    }
  );

  it('shows neither tool-specific reminder for other tools', async () => {
    const markup = await renderHint('test-tool');
    expect(markup).not.toContain('hint.devInvite');
    expect(markup).not.toContain('hint.responsesRequired');
  });
});
