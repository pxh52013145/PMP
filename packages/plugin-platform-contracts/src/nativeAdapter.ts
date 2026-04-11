export type NativeAdapterKind = 'native-sidecar.process';

export type NativeAdapterProtocol = 'pxp.runtime.bridge.v1';

export type NativeAdapterImplementationLanguage =
  | 'cpp'
  | 'qml'
  | 'rust'
  | 'csharp'
  | 'python'
  | 'go'
  | 'zig'
  | 'other';

export type NativeAdapterLifecyclePhase =
  | 'hello'
  | 'init'
  | 'activate'
  | 'health'
  | 'invoke'
  | 'revoke'
  | 'dispose';

export interface NativeAdapterImplementationDescriptor {
  language: NativeAdapterImplementationLanguage;
  runtime?: string;
  entry?: string;
  metadata?: Record<string, unknown>;
}

export interface NativeAdapterTrustDescriptor {
  minimumLevel?: 'unsigned-allowed' | 'trusted' | 'verified';
  requiresDigest?: boolean;
  requiresSignature?: boolean;
}

export interface NativeAdapterLifecycleDescriptor {
  phases?: NativeAdapterLifecyclePhase[];
  quarantineOnTimeout?: boolean;
  supportsGracefulShutdown?: boolean;
}

export interface NativeAdapterDescriptor {
  kind: NativeAdapterKind;
  protocol: NativeAdapterProtocol;
  implementation?: NativeAdapterImplementationDescriptor;
  trust?: NativeAdapterTrustDescriptor;
  lifecycle?: NativeAdapterLifecycleDescriptor;
  metadata?: Record<string, unknown>;
}

export const DEFAULT_NATIVE_ADAPTER_PROTOCOL: NativeAdapterProtocol =
  'pxp.runtime.bridge.v1';

export const DEFAULT_NATIVE_SIDECAR_LIFECYCLE_PHASES: NativeAdapterLifecyclePhase[] = [
  'hello',
  'init',
  'activate',
  'health',
  'invoke',
  'revoke',
  'dispose',
];

export function createNativeSidecarAdapterDescriptor(
  input: Omit<NativeAdapterDescriptor, 'kind' | 'protocol'> = {}
): NativeAdapterDescriptor {
  return {
    kind: 'native-sidecar.process',
    protocol: DEFAULT_NATIVE_ADAPTER_PROTOCOL,
    ...input,
    trust: {
      minimumLevel: 'trusted',
      requiresDigest: true,
      requiresSignature: false,
      ...(input.trust ?? {}),
    },
    lifecycle: {
      phases: [...DEFAULT_NATIVE_SIDECAR_LIFECYCLE_PHASES],
      quarantineOnTimeout: true,
      supportsGracefulShutdown: true,
      ...(input.lifecycle ?? {}),
    },
  };
}
