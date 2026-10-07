export function codexPlanLabel(plan?: string): string {
  const normalizedPlan = plan?.trim().toLowerCase().replace(/[-_]/g, ' ') ?? '';
  const proTier = normalizedPlan.match(/^pro\s*(100|200|500)$/)?.[1];
  return proTier || ['prolite', 'pro lite', 'pro 5x'].includes(normalizedPlan)
    ? `Pro ${proTier ?? '100'}`
    : ['pro', 'pro 20x'].includes(normalizedPlan)
      ? 'Pro 200'
      : ['promax', 'pro max'].includes(normalizedPlan)
        ? 'Pro 500'
        : normalizedPlan === 'team'
          ? 'Business'
          : normalizedPlan.replace(/\b\w/g, (letter) => letter.toUpperCase());
}
