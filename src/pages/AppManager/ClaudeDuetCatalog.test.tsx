import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import definition from '../../../tools/claudeduet/paths.json';
import mapping from '../../../tools/claudeduet/config.json';
import installIndex from '../../../docs/api/tools/install/index.json';
import appIcon from '../../../public/icons/tools/claudeduet.svg?raw';
import websiteIcon from '../../../docs/icons/tools/claudeduet.svg?raw';
import type { LocalTool } from '../../api/types';
import { ConfirmDialogProvider } from '../../components/ConfirmDialog';
import { useNavigationStore } from '../../stores/navigationStore';
import { ModelNexusContext } from '../ModelNexus/context';
import { AppManagerContext, type AppManagerContextType } from './context';
import { AppManagerBottom, AppManagerMain, AppManagerPanel } from './AppManagerComponents';

vi.mock('../../components', () => ({ getModelIcon: () => null }));

const duet: LocalTool = {
  ...definition,
  id: 'claudeduet',
  installed: false,
  icon: './icons/tools/claudeduet.svg',
};

beforeEach(() => {
  vi.stubGlobal('__APP_EDITION__', 'full');
  useNavigationStore.setState({ activePage: 'apps' });
});
afterEach(() => vi.unstubAllGlobals());

function context(selected = duet, viewMode: 'desktop' | 'install' = 'install') {
  return {
    detectedTools: [selected],
    selectedTool: selected.id,
    selectedToolData: selected,
    viewMode,
    aiInstallableIds: [],
    isScanning: false,
    setSelectedTool: vi.fn(),
    userModels: [{ internalId: 'fixture', name: 'Fixture Model', baseUrl: '', apiKey: '' }],
    toolModelConfig: {},
    handleSelectModel: vi.fn(),
    launchAfterApply: false,
    agreedConfigPolicy: false,
    isLaunching: false,
    handleLaunch: vi.fn(),
    onGoToMother: vi.fn(),
  } as unknown as AppManagerContextType;
}

function render(content: React.ReactNode, value = context()) {
  return renderToStaticMarkup(
    <ConfirmDialogProvider>
      <ModelNexusContext.Provider value={{} as React.ContextType<typeof ModelNexusContext>}>
        <AppManagerContext.Provider value={value}>{content}</AppManagerContext.Provider>
      </ModelNexusContext.Provider>
    </ConfirmDialogProvider>
  );
}

it('keeps the catalog entry free of guessed desktop installers and native paths', () => {
  expect(definition.website).toBe('https://claude.com/product/claude-duet');
  expect(definition.noModelConfig).toBe(true);
  expect(definition.apiProtocol).toEqual([]);
  expect(definition.command).toBe('');
  expect(definition.configFile).toBe('');
  expect(mapping.configFile).toBe('');
  expect(definition.paths).toEqual({ win32: [], darwin: [], linux: [] });
  expect(definition).not.toHaveProperty('alwaysInstalled', true);
  expect(definition).not.toHaveProperty('installUrl');
  expect(installIndex.ids).not.toContain(duet.id);
  expect(appIcon).toBe(websiteIcon);
  expect(appIcon).toContain('<svg');
});

it('lists Claude Duet with its icon under the existing Personal Agent category', () => {
  expect(definition.category).toBe('Cloud Agent');
  const markup = render(<AppManagerMain />);
  expect(markup).toContain('toolCat.cloudAgent');
  expect(markup).toContain('aria-label="Claude Duet"');
  expect(markup).toContain('./icons/tools/claudeduet.svg');
});

it.each(['desktop', 'install'] as const)(
  'offers only the official website in %s view',
  (viewMode) => {
    const value = context(duet, viewMode);
    const markup = render(
      <>
        <AppManagerPanel />
        <AppManagerBottom />
      </>,
      value
    );
    expect(markup).toContain(`href="${definition.website}"`);
    expect(markup).not.toContain('btn.installOneClick');
    expect(markup).not.toContain('btn.launchApp');
    expect(markup).not.toContain('btn.modifyOnly');
    expect(markup).not.toContain('agent.addAccount');
    expect(markup).not.toContain('Fixture Model');
    expect(value.handleLaunch).not.toHaveBeenCalled();
    expect(value.onGoToMother).not.toHaveBeenCalled();
  }
);

it('preserves the existing install action for other uninstalled apps', () => {
  const markup = render(
    <AppManagerBottom />,
    context({ ...duet, id: 'other-app', name: 'Other App' })
  );
  expect(markup).toContain('btn.installOneClick');
});
