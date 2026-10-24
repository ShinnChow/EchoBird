import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceAppIcon } from './VoiceAppIcon';

let renderer: ReactTestRenderer;
const listeners = new Set<() => void>();
const preference = {
  matches: false,
  addEventListener: vi.fn((_event: string, listener: () => void) => listeners.add(listener)),
  removeEventListener: vi.fn((_event: string, listener: () => void) => listeners.delete(listener)),
};
beforeEach(() => {
  preference.matches = false;
  listeners.clear();
  vi.stubGlobal('window', { matchMedia: vi.fn(() => preference) });
});
afterEach(() => {
  act(() => renderer?.unmount());
  vi.unstubAllGlobals();
});
const icon = () => renderer.root.findByType('img');
const spinning = () => renderer.root.findByType('span').props['data-spinning'];
const turn = () => act(() => icon().props.onAnimationIteration());
const loaded = () => act(() => icon().props.onLoad());

describe('foreground icon transition', () => {
  it('waits for both native lookup and image loading, then stops at a complete turn', () => {
    act(() => {
      renderer = create(<VoiceAppIcon src="old" loading={false} />);
    });
    loaded();
    expect(spinning()).toBe(false);
    act(() => renderer.update(<VoiceAppIcon src="old" loading />));
    expect(icon().props.src).toBe('old');
    turn();
    expect(spinning()).toBe(true);
    act(() => renderer.update(<VoiceAppIcon src="new" loading={false} />));
    turn();
    expect(spinning()).toBe(true);
    loaded();
    expect(spinning()).toBe(true);
    turn();
    expect(spinning()).toBe(false);
    expect(icon().props.src).toBe('new');
  });

  it('ignores late image callbacks from a window that is no longer current', () => {
    act(() => {
      renderer = create(<VoiceAppIcon src="first" loading={false} />);
    });
    act(() => renderer.update(<VoiceAppIcon src="second" loading={false} />));
    const late = icon().props;
    act(() => renderer.update(<VoiceAppIcon src="latest" loading={false} />));
    loaded();
    const staleImage = { src: 'second' };
    act(() => {
      late.onLoad();
      late.onError({ currentTarget: staleImage });
    });
    turn();
    expect(icon().props.src).toBe('latest');
    expect(staleImage.src).toBe('second');
    expect(spinning()).toBe(false);
  });

  it('loads the bird fallback after an image failure and still finishes the turn', () => {
    act(() => {
      renderer = create(<VoiceAppIcon src="old" loading />);
    });
    act(() => renderer.update(<VoiceAppIcon src="broken" loading={false} />));
    const image = { src: 'broken' };
    act(() => icon().props.onError({ currentTarget: image }));
    expect(image.src).toBe('/brand/bird.png');
    turn();
    expect(spinning()).toBe(true);
    loaded();
    turn();
    expect(spinning()).toBe(false);
  });

  it('settles when the lookup returns the same icon or no exposed icon', () => {
    act(() => {
      renderer = create(<VoiceAppIcon src="old" loading={false} />);
    });
    loaded();
    act(() => renderer.update(<VoiceAppIcon src="old" loading />));
    act(() => renderer.update(<VoiceAppIcon src="old" loading={false} />));
    turn();
    expect(spinning()).toBe(false);
    act(() => renderer.update(<VoiceAppIcon src="/brand/bird.png" loading={false} />));
    loaded();
    turn();
    expect(spinning()).toBe(false);
  });

  it('finishes an initial lookup at the next full turn even when the icon is unchanged', () => {
    act(() => {
      renderer = create(<VoiceAppIcon src="old" loading />);
    });
    loaded();
    act(() => renderer.update(<VoiceAppIcon src="old" loading={false} />));
    expect(spinning()).toBe(true);
    turn();
    expect(spinning()).toBe(false);
  });

  it('settles without animation events under reduced motion and cleans up its listener', () => {
    preference.matches = true;
    act(() => {
      renderer = create(<VoiceAppIcon src="old" loading />);
    });
    act(() => renderer.update(<VoiceAppIcon src="new" loading={false} />));
    loaded();
    expect(spinning()).toBe(false);
    expect(listeners.size).toBe(0);
    preference.matches = false;
    act(() => renderer.update(<VoiceAppIcon src="third" loading={false} />));
    loaded();
    expect(spinning()).toBe(true);
    act(() => {
      preference.matches = true;
      listeners.forEach((listener) => listener());
    });
    expect(spinning()).toBe(false);
    act(() => renderer.update(<VoiceAppIcon src="third" loading />));
    act(() => renderer.unmount());
    expect(listeners.size).toBe(0);
  });
});
