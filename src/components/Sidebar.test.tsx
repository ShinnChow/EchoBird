import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./BirdEasterEgg', () => ({ BirdEasterEgg: () => null }));
let Sidebar: typeof import('./Sidebar').Sidebar;
let renderer: ReactTestRenderer;

beforeAll(async () => {
  vi.stubGlobal('__APP_EDITION__', 'full');
  ({ Sidebar } = await import('./Sidebar'));
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => act(() => renderer?.unmount()));

const baseProps = {
  activePage: 'freeModels' as const,
  onPageChange: vi.fn(),
  smartRouterEnabled: false,
  smartRouterTogglePending: false,
  onSmartRouterChange: vi.fn(),
};
const routerGroups = [{ candidateIds: ['one'], groupEnabled: true }];

describe('Sidebar', () => {
  it('places AI news immediately above My AI Career', () => {
    const markup = renderToStaticMarkup(<Sidebar {...baseProps} smartRouterGroups={[]} />);
    expect(markup.indexOf('nav.aiNews')).toBeGreaterThan(-1);
    expect(markup.indexOf('nav.aiNews')).toBeLessThan(markup.indexOf('nav.aiCareer'));
  });

  it('hides the smart router switch when no model is connected', () => {
    const markup = renderToStaticMarkup(<Sidebar {...baseProps} smartRouterGroups={[]} />);

    expect(markup).not.toContain('aria-label="nav.smartRouter"');
  });

  it('shows the smart router switch when a model is connected', () => {
    const markup = renderToStaticMarkup(
      <Sidebar {...baseProps} smartRouterGroups={routerGroups} />
    );

    expect(markup).toContain('aria-label="nav.smartRouter"');
  });

  it.each([true, false])(
    'keeps the master reachable for seven closed groups while preserving master=%s',
    async (masterEnabled) => {
      const allOff = Array.from({ length: 7 }, (_, index) => ({
        candidateIds: [`model-${index}`],
        groupEnabled: false,
      }));
      const renderSidebar = (groups: typeof allOff) => (
        <Sidebar {...baseProps} smartRouterEnabled={masterEnabled} smartRouterGroups={groups} />
      );
      const toggles = () =>
        renderer.root.findAllByProps({ role: 'switch', 'aria-label': 'nav.smartRouter' });
      act(() => {
        renderer = create(renderSidebar(allOff));
      });
      expect(toggles()).toHaveLength(1);
      expect(toggles()[0].props['aria-checked']).toBe(masterEnabled);
      for (let index = 0; index < 7; index++) {
        const oneOpen = allOff.map((group, position) => ({
          ...group,
          groupEnabled: position === index,
        }));
        act(() => renderer.update(renderSidebar(oneOpen)));
        expect(toggles()).toHaveLength(1);
        expect(toggles()[0].props['aria-checked']).toBe(masterEnabled);
        act(() => renderer.update(renderSidebar(allOff)));
        expect(toggles()).toHaveLength(1);
        expect(toggles()[0].props['aria-checked']).toBe(masterEnabled);
      }
      for (const activePage of ['freeModels', 'apps', 'models'] as const) {
        act(() =>
          renderer.update(
            <Sidebar
              {...baseProps}
              activePage={activePage}
              smartRouterEnabled={masterEnabled}
              smartRouterGroups={allOff}
            />
          )
        );
        expect(toggles()[0].props['aria-checked']).toBe(masterEnabled);
      }
      expect(baseProps.onSmartRouterChange).not.toHaveBeenCalled();
      await act(async () => toggles()[0].props.onClick());
      expect(baseProps.onSmartRouterChange).toHaveBeenCalledExactlyOnceWith(!masterEnabled);
    }
  );

  it('keeps the master hidden without sources even when a group is enabled', () => {
    const markup = renderToStaticMarkup(
      <Sidebar
        {...baseProps}
        smartRouterEnabled
        smartRouterGroups={[{ candidateIds: [], groupEnabled: true }]}
      />
    );
    expect(markup).not.toContain('aria-label="nav.smartRouter"');
    expect(baseProps.onSmartRouterChange).not.toHaveBeenCalled();
  });
});
