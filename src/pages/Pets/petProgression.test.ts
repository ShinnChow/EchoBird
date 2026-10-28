import { expect, it } from 'vitest';
import { petStage } from './petConstants';
import {
  GROWTH_TOKEN_UNIT as YI,
  MAX_PET_LEVEL,
  TEST_GROWTH_BALANCE,
  isPetMilestone,
  petUpgradeCost,
} from './petProgression';

it('uses the confirmed five forms, holding the growing form at 40 and reaching adult at 50', () => {
  expect([0, 9, 10, 19, 20, 29, 30, 39, 40, 49, 50, 59, 60].map(petStage)).toEqual([
    0, 0, 1, 1, 2, 2, 3, 3, 3, 3, 4, 4, 4,
  ]);
});
it('adds half a hundred-million unit per tier and totals 135 units across sixty levels', () => {
  const costs = Array.from({ length: 60 }, (_, level) => petUpgradeCost(level));
  expect([0, 10, 20, 30, 40, 50].map((level) => petUpgradeCost(level) / YI)).toEqual([
    1, 1.5, 2, 2.5, 3, 3.5,
  ]);
  expect(costs.every(Number.isSafeInteger)).toBe(true);
  expect(costs.reduce((sum, cost) => sum + cost, 0)).toBe(135 * YI);
  expect(TEST_GROWTH_BALANCE).toBe(1000 * YI);
  expect(petUpgradeCost(MAX_PET_LEVEL)).toBe(0);
});
it('marks every tenth level, including the unchanged forms at 40 and 60, for the special cue', () => {
  expect(Array.from({ length: 61 }, (_, n) => n).filter(isPetMilestone)).toEqual([
    10, 20, 30, 40, 50, 60,
  ]);
});
