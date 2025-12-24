import type { WorkbenchContribution } from '../contracts/contributions';

export function normalizeWorkbenchId(value: string | null | undefined): string {
  return (value ?? '').trim();
}

export function sortWorkbenches(a: WorkbenchContribution, b: WorkbenchContribution): number {
  const orderA = typeof a.order === 'number' ? a.order : Number.POSITIVE_INFINITY;
  const orderB = typeof b.order === 'number' ? b.order : Number.POSITIVE_INFINITY;
  if (orderA !== orderB) return orderA - orderB;
  return a.title.localeCompare(b.title);
}

export function resolveActiveWorkbenchId(
  workbenches: WorkbenchContribution[],
  preferredId: string | null | undefined
): string | null {
  const normalized = normalizeWorkbenchId(preferredId);
  if (normalized && workbenches.some((wb) => wb.id === normalized)) {
    return normalized;
  }

  const sorted = [...workbenches].sort(sortWorkbenches);
  return sorted[0]?.id ?? null;
}

