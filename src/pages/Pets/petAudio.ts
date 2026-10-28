const ordinaryUrl = new URL('../../assets/pets/level-up.wav', import.meta.url).href;
const milestoneUrl = new URL('../../assets/pets/milestone.mp3', import.meta.url).href;

export function createPetAudio() {
  let clips: HTMLAudioElement[] = [];
  function stop() {
    for (const clip of clips) {
      clip.pause();
      clip.currentTime = 0;
    }
  }
  return {
    prepare() {
      if (clips.length) return;
      clips = [ordinaryUrl, milestoneUrl].map((url) => {
        const clip = new Audio(url);
        clip.preload = 'auto';
        clip.volume = 0.55;
        return clip;
      });
    },
    play(milestone: boolean) {
      stop();
      void clips[milestone ? 1 : 0]?.play().catch(() => {});
    },
    stop,
    dispose() {
      stop();
      for (const clip of clips) {
        clip.removeAttribute('src');
        clip.load();
      }
      clips = [];
    },
  };
}
