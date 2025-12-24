import type { WorkbenchContribution } from '../contracts/contributions';

export function normalizeWorkbenchId(value: string | null | undefined): string {
  return (value ?? '').trim();
}

type OrderableContribution = {
  id: string;
  title: string;
  order?: number;
};

export function normalizeContributionId(value: string | null | undefined): string {
  return (value ?? '').trim();
}

export function sortByOrderThenTitle<T extends OrderableContribution>(a: T, b: T): number {
  const orderA = typeof a.order === 'number' ? a.order : Number.POSITIVE_INFINITY;
  const orderB = typeof b.order === 'number' ? b.order : Number.POSITIVE_INFINITY;
  if (orderA !== orderB) return orderA - orderB;
  return a.title.localeCompare(b.title);
}

export function resolveActiveContributionId<T extends OrderableContribution>(
  contributions: T[],
  preferredId: string | null | undefined
): string | null {
  const normalized = normalizeContributionId(preferredId);
  if (normalized && contributions.some((item) => item.id === normalized)) {
    return normalized;
  }

  const sorted = [...contributions].sort(sortByOrderThenTitle);
  return sorted[0]?.id ?? null;
}

export function sortWorkbenches(a: WorkbenchContribution, b: WorkbenchContribution): number {
  return sortByOrderThenTitle(a, b);
}

export function resolveActiveWorkbenchId(
  workbenches: WorkbenchContribution[],
  preferredId: string | null | undefined
): string | null {
  return resolveActiveContributionId(workbenches, preferredId);
}
