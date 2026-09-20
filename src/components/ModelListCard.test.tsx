import React, { type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ModelListCard } from './ModelListCard';

const model = {
  internalId: 'saved-model',
  name: 'Saved Model',
  modelId: 'deepseek-flash',
  baseUrl: 'https://example.com/v1',
  apiKey: '',
};

function buttons(node: ReactNode): ReactElement<React.ButtonHTMLAttributes<HTMLButtonElement>>[] {
  if (!React.isValidElement<{ children?: ReactNode }>(node)) return [];
  if (node.type === 'button') return [node];
  return React.Children.toArray(node.props.children).flatMap(buttons);
}

describe('ModelListCard', () => {
  it('keeps actions usable on a model already selected in the router without selecting it again', () => {
    const onSelect = vi.fn();
    const onRefreshUsage = vi.fn();
    const onEditModel = vi.fn();
    const onDeleteModel = vi.fn();
    const card = ModelListCard({
      model,
      selection: <span>Selected</span>,
      selectionDisabled: true,
      onSelect,
      onRefreshUsage,
      onEditModel,
      onDeleteModel,
      usage: { quotas: [{ balance: 12.34, percentage: 80, resetAt: 0 }] },
      t: (key) => key,
    });
    const controls = buttons(card);
    expect(controls).toHaveLength(4);
    expect(controls[0].props.disabled).toBe(true);
    const stopPropagation = vi.fn();
    for (const control of controls.slice(1)) {
      expect(control.props.disabled).not.toBe(true);
      control.props.onClick?.({
        stopPropagation,
      } as unknown as React.MouseEvent<HTMLButtonElement>);
    }
    expect(stopPropagation).toHaveBeenCalledTimes(3);
    expect(onSelect).not.toHaveBeenCalled();
    expect(onRefreshUsage).toHaveBeenCalledWith(model.internalId);
    expect(onDeleteModel).toHaveBeenCalledWith(model.internalId);
    expect(onEditModel).toHaveBeenCalledWith(model);
    const markup = renderToStaticMarkup(card);
    expect(markup).toContain('deepseek-flash');
    expect(markup).toContain('12.34');
    expect(markup).not.toContain('example.com');
  });

  it('blocks duplicate balance refreshes and does not expose demo edit or delete actions', () => {
    const onRefreshUsage = vi.fn();
    const card = ModelListCard({
      model: { ...model, modelType: 'DEMO' },
      selection: null,
      onSelect: vi.fn(),
      onRefreshUsage,
      onEditModel: vi.fn(),
      onDeleteModel: vi.fn(),
      refreshing: true,
      t: (key) => key,
    });
    const controls = buttons(card);
    expect(controls).toHaveLength(2);
    expect(controls[1].props['aria-busy']).toBe(true);
    controls[1].props.onClick?.({
      stopPropagation: vi.fn(),
    } as unknown as React.MouseEvent<HTMLButtonElement>);
    expect(onRefreshUsage).not.toHaveBeenCalled();
  });
});
