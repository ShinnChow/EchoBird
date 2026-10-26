// Precomputed geometry for the latency indicator.
export function threadWaveY(x: number, index: number, phase: number): number {
  const envelope = Math.pow(Math.sin((x / 72) * Math.PI), 1.2);
  const wave = Math.sin(x * 0.085 - 0.8 * 1.7 - phase + index * 0.19);
  return 8 + envelope * (wave * (2.5 + index * 0.48) + (index - 3) * 0.5);
}

export const latencyThreadDuration = (Math.PI * 2) / 1.7;
export const latencyThreads = Array.from({ length: 7 }, (_, index) => {
  const frames = Array.from({ length: 25 }, (_, frame) =>
    Array.from({ length: 37 }, (_, point) => {
      const x = point * 2;
      const y = threadWaveY(x, index, (frame / 24) * Math.PI * 2);
      return `${point === 0 ? 'M' : 'L'}${x},${y.toFixed(2)}`;
    }).join(' ')
  );
  return { path: frames[0], frames: frames.join(';') };
});
