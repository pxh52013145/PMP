import type { ServiceToken } from './tokens';

export type RegisterOptions = {
  replace?: boolean;
};

export class ServiceRegistry {
  private readonly services = new Map<symbol, unknown>();

  register<T>(token: ServiceToken<T>, service: T, options: RegisterOptions = {}): () => void {
    const exists = this.services.has(token.key);
    if (exists && !options.replace) {
      throw new Error(`[ServiceRegistry] Service already registered: ${token.debugName}`);
    }
    this.services.set(token.key, service);
    return () => {
      const current = this.services.get(token.key);
      if (current === service) {
        this.services.delete(token.key);
      }
    };
  }

  get<T>(token: ServiceToken<T>): T {
    const service = this.services.get(token.key) as T | undefined;
    if (!service) {
      throw new Error(`[ServiceRegistry] Missing service: ${token.debugName}`);
    }
    return service;
  }

  getOptional<T>(token: ServiceToken<T>): T | null {
    return (this.services.get(token.key) as T | undefined) ?? null;
  }

  has<T>(token: ServiceToken<T>): boolean {
    return this.services.has(token.key);
  }

  clear(): void {
    this.services.clear();
  }
}

