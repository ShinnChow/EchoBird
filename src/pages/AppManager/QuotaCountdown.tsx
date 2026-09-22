import React, { useEffect, useState } from 'react';

function formatQuotaCountdown(resetAt: number, now: number): string {
  const minutes = Math.max(0, Math.ceil((resetAt * 1000 - now) / 60_000));
  if (minutes >= 24 * 60) {
    const days = Math.floor(minutes / (24 * 60));
    const hours = Math.floor((minutes % (24 * 60)) / 60);
    return `${days}d${hours}h`;
  }
  if (minutes >= 60) {
    return `${Math.floor(minutes / 60)}h${minutes % 60}m`;
  }
  return `${minutes}m`;
}

export const QuotaCountdown: React.FC<{ resetAt?: number | null }> = ({ resetAt }) => {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!resetAt) return;
    const initial = setTimeout(() => setNow(Date.now()), 0);
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [resetAt]);
  return (
    <span className="w-[64px] flex-shrink-0 text-center text-[12px] font-semibold leading-[16px] text-cyber-text">
      {resetAt && now ? formatQuotaCountdown(resetAt, now) : ''}
    </span>
  );
};
