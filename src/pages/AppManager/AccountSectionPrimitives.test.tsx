import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { AccountSectionButton } from './AccountSectionPrimitives';

vi.mock('../../hooks/useI18n', () => ({
  useI18n: () => ({
    t: (key: string) =>
      key === 'agent.waitingForBrowser' ? 'Waiting for browser ({seconds})' : key,
  }),
}));

describe('account login cancellation button', () => {
  it.each([undefined, 'Please quit the Cue app ({seconds})'])(
    'cancels %s without starting another login, even when adding is disabled',
    (waitingLabel) => {
      const add = vi.fn();
      const cancel = vi.fn();
      const renderer = create(
        <AccountSectionButton
          iconSrc="/icons/tools/cue.png"
          busy
          disabled
          remainingSeconds={58}
          waitingLabel={waitingLabel}
          onClick={add}
          onCancel={cancel}
        />
      );
      try {
        expect(JSON.stringify(renderer.toJSON())).toContain('58');
        const button = renderer.root.findByType('button');
        expect(button.props['aria-label']).toBe('btn.cancel');
        expect(button.props.disabled).not.toBe(true);
        const stopPropagation = vi.fn();
        act(() => button.props.onClick({ stopPropagation }));
        expect(cancel).toHaveBeenCalledTimes(1);
        expect(stopPropagation).toHaveBeenCalledTimes(1);
        expect(add).not.toHaveBeenCalled();
      } finally {
        act(() => renderer.unmount());
      }
    }
  );

  it('keeps the ordinary add action when idle and preserves the provider choice while waiting', () => {
    const add = vi.fn();
    const cancel = vi.fn();
    const props = {
      iconSrc: '/icons/tools/zcode.png',
      remainingSeconds: 60,
      onClick: add,
      onCancel: cancel,
    };
    const renderer = create(<AccountSectionButton {...props} busy={false} />);
    try {
      const addButton = renderer.root.findByType('button');
      expect(addButton.props.disabled).toBeFalsy();
      act(() => addButton.props.onClick());
      expect(add).toHaveBeenCalledTimes(1);
      expect(cancel).not.toHaveBeenCalled();
      act(() =>
        renderer.update(
          <AccountSectionButton {...props} busy secondary={<button disabled>Z.ai</button>} />
        )
      );
      expect(JSON.stringify(renderer.toJSON())).toContain('Z.ai');
      expect(renderer.root.findByProps({ 'aria-label': 'btn.cancel' }).props.disabled).not.toBe(
        true
      );
      expect(renderer.root.findAllByType('button')).toHaveLength(2);
    } finally {
      act(() => renderer.unmount());
    }
  });
});
