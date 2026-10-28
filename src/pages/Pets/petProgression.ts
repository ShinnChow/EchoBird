export const GROWTH_TOKEN_UNIT = 100_000_000;
export const TEST_GROWTH_BALANCE = 1000 * GROWTH_TOKEN_UNIT;
export const MAX_PET_LEVEL = 60;
export const EGG_COST = GROWTH_TOKEN_UNIT;

// Each entry covers ten upgrades: 0→1 … 9→10, then 10→11 … 19→20, etc.
export const LEVEL_COSTS_IN_YI = [1, 1.5, 2, 2.5, 3, 3.5] as const;
export function petUpgradeCost(level: number): number {
  return level >= MAX_PET_LEVEL ? 0 : LEVEL_COSTS_IN_YI[Math.floor(level / 10)] * GROWTH_TOKEN_UNIT;
}
export const isPetMilestone = (nextLevel: number) => nextLevel > 0 && nextLevel % 10 === 0;
