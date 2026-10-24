import { useEffect, useLayoutEffect, useRef } from 'react';
import type { VoiceConfig, VoicePalette } from '../../api/voiceInput';
import { VoiceBarsRenderer } from './VoiceBarsRenderer';
import { VoiceRecordingTrail } from './VoiceRecordingTrail';

interface Props {
  level: number;
  active: boolean;
  speaking?: boolean;
  palette?: VoicePalette;
  theme: VoiceConfig['islandTheme'];
}

export function VoiceFlow({ level, active, speaking = false, palette = 'white', theme }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const input = useRef({ level, active, speaking, theme, palette });
  const wake = useRef(() => {});
  useLayoutEffect(() => {
    input.current = { level, active, speaking, theme, palette };
    wake.current();
  }, [level, active, speaking, theme, palette]);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let wave: VoiceBarsRenderer | undefined;
    let trail: VoiceRecordingTrail | undefined;
    let frame = 0;
    let last: number | null = null;
    let visible = true;
    let disposed = false;
    let failed = false;
    const stop = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      last = null;
    };
    const schedule = () => {
      if (!disposed && !failed && visible && !document.hidden && !frame)
        frame = requestAnimationFrame(draw);
    };
    const refresh = () => {
      stop();
      schedule();
    };
    const draw = (now: number) => {
      frame = 0;
      if (disposed || failed || !visible || document.hidden) return;
      if (last !== null && now - last < 1000 / 60 - 0.5) {
        schedule();
        return;
      }
      const dt = last === null ? 1 / 60 : Math.min(0.05, (now - last) / 1000);
      last = now;
      const current = input.current;
      const light =
        current.theme === 'light' ||
        (current.theme === 'auto' && document.documentElement.dataset.theme === 'light');
      const ratio = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
      if (!wave || wave.ratio !== ratio) {
        trail?.reset();
        trail = undefined;
        wave?.dispose();
        try {
          wave = new VoiceBarsRenderer(element, ratio);
        } catch {
          failed = true;
          return;
        }
      }
      wave.drawFrame(
        {
          state: !current.active ? 'disabled' : current.speaking ? 'speaking' : 'thinking',
          level: current.level,
          light,
          reduced: reduced.matches,
        },
        dt
      );
      if (current.active && current.speaking && !reduced.matches) {
        trail ??= new VoiceRecordingTrail(wave.canvas, ratio);
        trail.draw(dt);
      } else {
        trail?.reset();
      }
      wave.colorize(current.palette, light);
      if (current.active && !reduced.matches) schedule();
    };
    const observer =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver((entries) => {
            visible = entries.some((entry) => entry.isIntersecting);
            refresh();
          });
    observer?.observe(element);
    wake.current = schedule;
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('resize', refresh);
    reduced.addEventListener('change', refresh);
    schedule();
    return () => {
      disposed = true;
      wake.current = () => {};
      stop();
      observer?.disconnect();
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('resize', refresh);
      reduced.removeEventListener('change', refresh);
      trail?.reset();
      wave?.dispose();
    };
  }, []);

  return (
    <div
      ref={host}
      className="voice-island-flow"
      data-recording={active && speaking}
      aria-hidden="true"
    />
  );
}
