import { expect, it } from 'vitest';
import { latencyThreadDuration, latencyThreads } from './threadWave';

it('preserves every approved latency SVG keyframe and its original duration', async () => {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(latencyThreads))
  );
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
  expect(hash).toBe('43f725a2375110e5823af87b13cb8ac79427f6a8e95b60a859c88d4713da5a63');
  expect(latencyThreadDuration).toBeCloseTo(3.695991357, 8);
});
