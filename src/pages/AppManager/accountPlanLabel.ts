export function isFreePlan(plan?: string | null): boolean {
  return plan?.trim().toLowerCase() === 'free';
}

export function accountPlanLabel(plan: string): string {
  return isFreePlan(plan) ? 'Free' : plan.replace(/^[a-z]/, (letter) => letter.toUpperCase());
}
