import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { RoutingToggle } from './RoutingToggle';

describe('RoutingToggle', () => {
  it('disables changes while a service transition is pending', () => {
    const markup = renderToStaticMarkup(
      <RoutingToggle label="Smart Router" checked={false} disabled onChange={vi.fn()} />
    );
    expect(markup).toContain('role="switch"');
    expect(markup).toContain('aria-checked="false"');
    expect(markup).toContain('disabled=""');
    expect(markup).not.toContain('cursor-wait');
  });
});
