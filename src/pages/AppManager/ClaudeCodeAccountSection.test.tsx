import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ClaudeCodeAccountSection } from './ClaudeCodeAccountSection';
import { AppManagerContext, type AppManagerContextType } from './context';

function renderAccount(quotaPercent: number | null, busy = false) {
  const context = {
    claudeCodeAccounts: {
      accounts: [
        {
          id: 'test',
          email: 'test@example.com',
          plan: 'Max 5X',
          fiveHour: quotaPercent == null ? null : { remainingPercent: quotaPercent },
          sevenDay: { remainingPercent: 82 },
        },
      ],
      selectedId: 'test',
      busy,
      remainingSeconds: 600,
      refreshing: new Set(),
      select: () => {},
      add: async () => {},
      refresh: async () => {},
      remove: async () => {},
    },
  } as unknown as AppManagerContextType;
  return renderToStaticMarkup(
    <AppManagerContext.Provider value={context}>
      <ClaudeCodeAccountSection showDivider={false} />
    </AppManagerContext.Provider>
  );
}

describe('Claude Code account card', () => {
  it('keeps the compact account layout without tooltips or cursor overrides', () => {
    const markup = renderAccount(37);
    expect(markup).toContain('test@example.com');
    expect(markup).toContain('Max 5X');
    expect(markup).toContain('5h: 37%');
    expect(markup).toContain('7d: 82%');
    expect(markup).not.toContain('width:');
    expect(markup).not.toContain('h-1.5');
    expect(markup).toContain('aria-checked="true"');
    expect(markup).toContain('grid h-12');
    expect(markup).not.toContain('title=');
    expect(markup).not.toContain('tooltip');
    expect(markup).not.toContain('cursor-');
    expect(markup).not.toContain('dialog');
    expect(markup).not.toContain('waitingForBrowser');
  });

  it('distinguishes unavailable quota from an exhausted account', () => {
    expect(renderAccount(null)).toContain('—');
    expect(renderAccount(null)).not.toContain('5h: 0%');
    expect(renderAccount(0)).toContain('5h: 0%');
  });

  it('disables adding and shows the existing waiting label during OAuth', () => {
    const markup = renderAccount(37, true);
    expect(markup).toContain('disabled=""');
    expect(markup).toContain('agent.waitingForBrowser');
    expect(markup).not.toContain('agent.addCurrentAccount');
  });
});
