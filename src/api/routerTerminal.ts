import { invoke } from '@tauri-apps/api/core';

export interface TerminalSegment {
  text: string;
  protectedText: string | null;
  kind: number | null;
}

export function pollRouterTerminal(session: string, routerId: string) {
  return invoke<TerminalSegment[][]>('poll_smart_router_terminal', { session, routerId });
}

export function stopRouterTerminal(session: string) {
  return invoke<void>('stop_smart_router_terminal', { session });
}
