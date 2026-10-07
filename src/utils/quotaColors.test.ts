import { describe, expect, it } from 'vitest';
import { quotaTone } from './quotaColors';
import { quotaPercent } from './modelUsage';

describe('remaining quota colors', () => {
  it.each([
    [100, 'healthy'],
    [30.1, 'healthy'],
    [30, 'low'],
    [10.1, 'low'],
    [10, 'critical'],
    [0, 'critical'],
  ] as const)('assigns %s%% remaining to %s', (percent, tone) => {
    expect(quotaTone(percent)).toBe(tone);
  });

  it.each([null, undefined, NaN, Infinity, -Infinity])(
    'keeps unknown quota %s neutral',
    (percent) => {
      expect(quotaTone(percent)).toBe('unknown');
    }
  );

  it('uses remaining model allowance while preserving legacy percentages', () => {
    const quota = { period: 'weekly' as const, resetAt: 0 };
    expect(quotaTone(quotaPercent({ ...quota, percentage: 10 }))).toBe('healthy');
    expect(quotaTone(quotaPercent({ ...quota, percentage: 70 }))).toBe('low');
    expect(quotaTone(quotaPercent({ ...quota, percentage: 90 }))).toBe('critical');
    expect(quotaTone(quotaPercent({ percentage: 90, resetAt: 0 }))).toBe('healthy');
    expect(quotaTone(quotaPercent({ ...quota, percentage: NaN }))).toBe('unknown');
  });
});
