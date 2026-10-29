import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import {
  pollRouterTerminal,
  stopRouterTerminal,
  type TerminalSegment,
} from '../../api/routerTerminal';

import type { TerminalPlayback } from './terminalCanvas';

export function useTerminalFeed(
  group: string,
  active: boolean,
  playbackRef?: MutableRefObject<TerminalPlayback>
) {
  const pending = useRef<TerminalSegment[][]>([]);
  const [error, setError] = useState(false);
  const [source, setSource] = useState({ group, realtime: false });
  useEffect(() => {
    pending.current = [];
    if (playbackRef) {
      playbackRef.current = {
        ...playbackRef.current,
        group,
        realtime: false,
        generation: playbackRef.current.generation + 1,
      };
    }
    if (!active) return;
    const session = crypto.randomUUID();
    let alive = true;
    let realtime = false;
    let timer: ReturnType<typeof setTimeout>;
    const stop = () => void stopRouterTerminal(session).catch(() => {});
    const poll = async () => {
      try {
        const rows = await pollRouterTerminal(session, group);
        if (!alive) {
          stop();
          return;
        }
        if (rows.length && !realtime) {
          realtime = true;
          if (playbackRef) {
            playbackRef.current = {
              ...playbackRef.current,
              realtime: true,
              generation: playbackRef.current.generation + 1,
            };
          }
        }
        setSource({ group, realtime });
        pending.current = [...pending.current, ...rows].slice(-128);
        setError(false);
      } catch {
        if (alive) setError(true);
      }
      if (alive) timer = setTimeout(() => void poll(), 600);
    };
    void poll();
    return () => {
      alive = false;
      clearTimeout(timer);
      pending.current = [];
      stop();
    };
  }, [group, active, playbackRef]);
  return { pending, error, realtime: source.group === group && source.realtime };
}
