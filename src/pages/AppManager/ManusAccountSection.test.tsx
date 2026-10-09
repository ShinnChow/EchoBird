import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ManusAccountSection } from './ManusAccountSection';
import { AppManagerContext, type AppManagerContextType } from './context';
import { I18nContext } from '../../hooks/i18nContext';
import { en } from '../../i18n/en';

// The necessary native-exit instruction stays in the existing account button.
function render(awaitingClientExit: boolean) {
  const context = {
    manusAccounts: { accounts: [], busy: true, remainingSeconds: 30, awaitingClientExit },
  } as unknown as AppManagerContextType;
  return renderToStaticMarkup(
    <I18nContext.Provider value={{ locale: 'en', setLocale: () => {}, t: (key) => en[key] }}>
      <AppManagerContext.Provider value={context}>
        <ManusAccountSection />
      </AppManagerContext.Provider>
    </I18nContext.Provider>
  );
}

describe('Manus native login instruction', () => {
  it('reuses the fixed-height button for browser waiting and manual client exit', () => {
    const waiting = render(false);
    const exit = render(true);
    expect(waiting).toContain('Waiting for browser (30)');
    expect(exit).toContain('Please quit Manus (30)');
    expect(exit).not.toContain('Waiting for browser');
    expect(exit).toContain('h-12');
    expect(exit).toContain('disabled=""');
    expect(exit).toContain('/icons/tools/manus.png');
    expect(exit).not.toContain('title=');
    expect(exit).not.toContain('cursor-');
  });
});
