import { useEffect, type MutableRefObject } from 'react';
import { nativeBaseTrackWindowCoversRequest, type NativeBaseWindowRequest } from './nativeBaseWindow';

export function useNativeBaseWindowLoader(options: {
  enabled: boolean;
  queryKey: string;
  request: NativeBaseWindowRequest | null;
  total: number | null;
  tracksRef: MutableRefObject<readonly unknown[] | null>;
  offsetRef: MutableRefObject<number>;
  loadingRef: MutableRefObject<boolean>;
  isLoading: boolean;
  load: (options: { offset: number; limit: number; reset: boolean }) => Promise<boolean>;
}): void {
  const { enabled, queryKey, request, total, tracksRef, offsetRef, loadingRef, isLoading, load } = options;

  useEffect(() => {
    if (!enabled || !request || total === 0) return;

    // Query resets update refs synchronously. The rendered loading flag can still
    // belong to the cancelled query, so it must not block its replacement.
    if (loadingRef.current) return;
    const currentOffset = offsetRef.current;
    const currentLength = tracksRef.current?.length ?? 0;
    if (nativeBaseTrackWindowCoversRequest({ currentOffset, currentLength, request, total })) return;

    void load({
      offset: request.offset,
      limit: request.limit,
      reset: currentLength === 0 && currentOffset === 0,
    });
  }, [enabled, queryKey, request, total, tracksRef, offsetRef, loadingRef, isLoading, load]);
}
