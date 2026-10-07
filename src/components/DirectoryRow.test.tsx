import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
import { DirectoryRow } from './DirectoryRow';

it('keeps directory add and website actions separate', () => {
  const add = vi.fn();
  const open = vi.fn();
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <DirectoryRow
        name="Provider"
        url="https://example.test"
        onOpen={open}
        openLabel="Open website"
        add={{ onClick: add, label: 'Add account' }}
      />
    );
  });
  try {
    const [addButton, websiteButton] = renderer.root.findAllByType('button');
    act(() => websiteButton.props.onClick());
    expect(open).toHaveBeenCalledTimes(1);
    expect(add).not.toHaveBeenCalled();
    act(() => addButton.props.onClick());
    expect(add).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledTimes(1);
  } finally {
    act(() => renderer.unmount());
  }
});

it('a subscription-service row has only its website action', () => {
  const open = vi.fn();
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <DirectoryRow
        name="Service fixture"
        url="https://example.test"
        onOpen={open}
        openLabel="Open service"
      />
    );
  });
  try {
    const buttons = renderer.root.findAllByType('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0].props['aria-label']).toBe('Open service');
    act(() => buttons[0].props.onClick());
    expect(open).toHaveBeenCalledTimes(1);
  } finally {
    act(() => renderer.unmount());
  }
});
