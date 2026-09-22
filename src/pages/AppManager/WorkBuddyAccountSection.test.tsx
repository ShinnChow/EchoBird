import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WorkBuddyAccountSection } from './WorkBuddyAccountSection';
import { AppManagerContext, type AppManagerContextType } from './context';
import type { WorkBuddyEdition } from '../../api/tauri';

function renderAccount(
  remaining: number | null,
  edition: WorkBuddyEdition = 'workbuddy',
  busy = false,
  plan: string | null = 'Free'
) {
  const context = {
    selectedTool: edition,
    workBuddyAccounts: {
      accounts: [
        {
          id: 'test',
          name: 'test@example.com',
          edition,
          plan,
          remaining,
          total: 100,
          expiresAt: 1900000000,
        },
      ],
      selectedId: 'test',
      busy,
      remainingSeconds: 100,
      refreshing: new Set(),
      select: () => {},
      add: async () => {},
      refresh: async () => {},
      remove: async () => {},
    },
  } as unknown as AppManagerContextType;
  return renderToStaticMarkup(
    <AppManagerContext.Provider value={context}>
      <WorkBuddyAccountSection showDivider={false} />
    </AppManagerContext.Provider>
  );
}

describe('WorkBuddy account card', () => {
  it.each(['Free', 'Pro', 'Team', null])('shows the account tier %s above the actions', (plan) => {
    const markup = renderAccount(10, 'workbuddy', false, plan);
    expect(markup).toContain(`>${plan || '—'}</span><span class="flex items-center gap-1.5">`);
  });
  it.each(['workbuddy', 'workbuddyai'] as const)(
    'uses the existing compact layout for %s without extra guidance',
    (edition) => {
      const markup = renderAccount(75.25, edition);
      expect(markup).toContain(`/icons/tools/${edition}.png`);
      expect(markup).toContain('test@example.com');
      expect(markup).toContain('75.25');
      expect(markup).toContain('width:75.25%');
      expect(markup).toContain('aria-checked="true"');
      expect(markup).toContain('grid h-12');
      expect(markup).not.toContain('title=');
      expect(markup).not.toContain('tooltip');
      expect(markup).not.toContain('cursor-');
      expect(markup).not.toMatch(/<p(?:\s|>)/);
    }
  );
  it('distinguishes unknown credit from zero and clamps the progress bar', () => {
    expect(renderAccount(null)).toContain('—');
    expect(renderAccount(0)).not.toContain('—');
    expect(renderAccount(120)).toContain('width:100%');
    expect(renderAccount(120)).toContain('120');
  });
  it('uses the existing authorization waiting state', () => {
    const markup = renderAccount(10, 'workbuddyai', true);
    expect(markup).toContain('disabled=""');
    expect(markup).toContain('agent.waitingForBrowser');
    expect(markup).not.toContain('agent.addCurrentAccount');
  });
});
