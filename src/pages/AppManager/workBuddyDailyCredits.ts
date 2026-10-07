import { useEffect, useState } from 'react';

export const workBuddyClaimedToday = (at?: number | null, now = Date.now()) =>
  at != null && Math.floor((at + 8 * 3600) / 86400) === Math.floor((now / 1000 + 8 * 3600) / 86400);

export function useWorkBuddyClaimedToday(enabled: boolean) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [enabled]);
  return (at?: number | null) => workBuddyClaimedToday(at, now);
}
