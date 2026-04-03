export type Contribution = {
  kind: string;
  id: string;
};
import { getKernelLogger } from './logging';

export type ContributionListener = () => void;
const telemetry = getKernelLogger('ContributionRegistry');

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type RegisterContributionOptions = {
  replace?: boolean;
};

export interface ContributionRegistryApi {
  register<C extends Contribution>(contribution: C, options?: RegisterContributionOptions): () => void;
  get<C extends Contribution>(kind: C['kind'], id: string): C | null;
  list<C extends Contribution>(kind: C['kind']): C[];
  listAll<C extends Contribution>(): C[];
  subscribe(listener: ContributionListener): () => void;
}

export class ContributionRegistry implements ContributionRegistryApi {
  private readonly byKind = new Map<string, Map<string, unknown>>();
  private readonly listeners = new Set<ContributionListener>();

  register<C extends Contribution>(
    contribution: C,
    options: RegisterContributionOptions = {}
  ): () => void {
    const kind = contribution.kind;
    const id = contribution.id;
    if (!kind) throw new Error('[ContributionRegistry] contribution.kind is required');
    if (!id) throw new Error('[ContributionRegistry] contribution.id is required');

    let kindMap = this.byKind.get(kind);
    if (!kindMap) {
      kindMap = new Map();
      this.byKind.set(kind, kindMap);
    }

    const exists = kindMap.has(id);
    if (exists && !options.replace) {
      throw new Error(`[ContributionRegistry] Contribution already registered: ${kind}/${id}`);
    }

    kindMap.set(id, contribution);
    this.notify();

    return () => {
      const currentKindMap = this.byKind.get(kind);
      if (!currentKindMap) return;
      const current = currentKindMap.get(id);
      if (current !== contribution) return;
      currentKindMap.delete(id);
      if (currentKindMap.size === 0) {
        this.byKind.delete(kind);
      }
      this.notify();
    };
  }

  get<C extends Contribution>(kind: C['kind'], id: string): C | null {
    const kindMap = this.byKind.get(kind);
    if (!kindMap) return null;
    return (kindMap.get(id) as C | undefined) ?? null;
  }

  list<C extends Contribution>(kind: C['kind']): C[] {
    const kindMap = this.byKind.get(kind);
    if (!kindMap || kindMap.size === 0) return [];
    return Array.from(kindMap.values()) as C[];
  }

  listAll<C extends Contribution>(): C[] {
    const result: C[] = [];
    for (const kindMap of this.byKind.values()) {
      result.push(...(Array.from(kindMap.values()) as C[]));
    }
    return result;
  }

  subscribe(listener: ContributionListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  clear(): void {
    this.byKind.clear();
    this.notify();
  }

  private notify(): void {
    for (const listener of Array.from(this.listeners)) {
      try {
        listener();
      } catch (error) {
        telemetry.warn('contribution_registry.listener.failed', {
          message: readErrorMessage(error),
        });
      }
    }
  }
}
