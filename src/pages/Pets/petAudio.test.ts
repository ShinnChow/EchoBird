import { afterEach, expect, it, vi } from 'vitest';
import { createPetAudio } from './petAudio';

afterEach(() => vi.unstubAllGlobals());
it('loads only after explicit preparation, chooses one cue and releases media on exit', async () => {
  const clips: {
    play: ReturnType<typeof vi.fn>;
    pause: ReturnType<typeof vi.fn>;
    removeAttribute: ReturnType<typeof vi.fn>;
    load: ReturnType<typeof vi.fn>;
    currentTime: number;
  }[] = [];
  vi.stubGlobal(
    'Audio',
    vi.fn(function () {
      const clip = {
        play: vi.fn(() => Promise.resolve()),
        pause: vi.fn(),
        removeAttribute: vi.fn(),
        load: vi.fn(),
        currentTime: 0,
      };
      clips.push(clip);
      return clip;
    })
  );
  const sound = createPetAudio();
  expect(clips).toHaveLength(0);
  sound.prepare();
  sound.prepare();
  expect(clips).toHaveLength(2);
  sound.play(false);
  expect(clips[0].play).toHaveBeenCalledTimes(1);
  expect(clips[1].play).not.toHaveBeenCalled();
  sound.play(true);
  expect(clips[1].play).toHaveBeenCalledTimes(1);
  sound.dispose();
  expect(
    clips.every(
      (clip) =>
        clip.pause.mock.calls.length > 0 &&
        clip.removeAttribute.mock.calls.length === 1 &&
        clip.load.mock.calls.length === 1
    )
  ).toBe(true);
});
