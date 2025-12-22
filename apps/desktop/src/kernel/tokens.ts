export type ServiceToken<T> = {
  readonly key: symbol;
  readonly debugName: string;
  readonly __type?: (_: T) => T;
};

export function createServiceToken<T>(debugName: string): ServiceToken<T> {
  return {
    key: Symbol.for(debugName),
    debugName,
  };
}
