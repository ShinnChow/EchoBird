import { expect, it } from 'vitest';
import { createVoxelModels } from './voxelModels.js';

it('preserves the six approved voxel species, three forms and a shared shell', () => {
  const models = createVoxelModels();
  expect(models.definitions).toHaveLength(18);
  expect(new Set(models.definitions.map((model) => model.kind)).size).toBe(6);
  expect([...models.egg.keys()]).toEqual([...models.cracked.keys()]);
  expect(models.egg.size).toBeGreaterThan(100);
  for (const definition of models.definitions) expect(definition.voxels.size).toBeGreaterThan(50);
});

it('grows continuously from exact source cells to target cells in all twelve transitions', () => {
  const { transitions, growthCell } = createVoxelModels();
  expect(transitions).toHaveLength(12);
  for (const transition of transitions) {
    let moving = 0;
    for (const track of transition.tracks) {
      const start = growthCell(track, 0),
        end = growthCell(track, 1),
        middle = growthCell(track, 0.5);
      expect(start.p).toEqual(track.a);
      expect(end.p).toEqual(track.b);
      expect(start.scale).toBe(track.sa);
      expect(end.scale).toBe(track.sb);
      expect(middle.p.every(Number.isFinite)).toBe(true);
      expect(middle.scale).toBeGreaterThanOrEqual(0);
      if (middle.u > 0 && middle.u < 1) moving++;
    }
    expect(moving).toBeGreaterThan(0);
  }
});
