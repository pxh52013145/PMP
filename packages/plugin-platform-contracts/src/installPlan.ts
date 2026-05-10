import type {
  CapabilityRequirement,
  DependencyDescriptor,
  IntegrityDescriptor,
  PxpManifestV2,
} from './core';
import type {
  PmpExperiencePackSpaceApplyMode,
  PmpKnownPackageType,
  PmpPackageMetadataV1,
  PmpPackageSourceV1,
} from './packageManifests';

export type PmpInstallPlanFormatVersion = '1.0';

export type PmpInstallPlanStatus = 'ready' | 'blocked' | 'partial';

export type PmpInstallPlanSeverity = 'info' | 'warning' | 'error';

export interface PmpInstallPlanLocalFileSourceV1 {
  kind: 'local-file';
  path: string;
  sha256?: string;
}

export interface PmpInstallPlanLocalDirectorySourceV1 {
  kind: 'local-directory';
  path: string;
}

export interface PmpInstallPlanMemorySourceV1 {
  kind: 'memory';
  label?: string;
  sha256?: string;
}

export type PmpInstallPlanSourceV1 =
  | PmpPackageSourceV1
  | PmpInstallPlanLocalFileSourceV1
  | PmpInstallPlanLocalDirectorySourceV1
  | PmpInstallPlanMemorySourceV1;

export interface PmpInstallPlanPackageSourceV1 {
  packageType: PmpKnownPackageType;
  source: PmpInstallPlanSourceV1;
  metadata?: PmpPackageMetadataV1;
  integrity?: IntegrityDescriptor;
}

export interface PmpInstallPlanDiagnosticV1 {
  severity: PmpInstallPlanSeverity;
  code: string;
  message: string;
  targetStepId?: string;
  details?: unknown;
}

export interface PmpInstallPlanReviewItemV1 {
  id: string;
  kind:
    | 'capability'
    | 'dependency'
    | 'overwrite'
    | 'signature'
    | 'space-layout'
    | 'network'
    | 'native-sidecar';
  required?: boolean;
  title?: string;
  message?: string;
  details?: unknown;
}

export interface PmpInstallPlanDependencyV1 extends DependencyDescriptor {
  source?: PmpInstallPlanSourceV1;
  installedVersion?: string;
  resolved?: boolean;
}

export interface PmpInstallPlanSummaryV1 {
  title: string;
  description?: string;
  packageType: PmpKnownPackageType;
  extensionCount?: number;
  resourceCount?: number;
  appliesTheme?: boolean;
  appliesProfile?: boolean;
  appliesSpaces?: boolean;
  requiresNetwork?: boolean;
  hasNativeSidecar?: boolean;
  destructive?: boolean;
}

export type PmpInstallPlanStepKind =
  | 'verify-integrity'
  | 'install-extension'
  | 'install-resource'
  | 'refresh-plugin-registries'
  | 'apply-theme'
  | 'apply-profile'
  | 'apply-space-layout'
  | 'report';

export interface PmpInstallPlanStepBaseV1 {
  id: string;
  kind: PmpInstallPlanStepKind;
  required?: boolean;
  dependsOn?: string[];
  title?: string;
  description?: string;
}

export interface PmpVerifyIntegrityStepV1 extends PmpInstallPlanStepBaseV1 {
  kind: 'verify-integrity';
  source: PmpInstallPlanSourceV1;
  checksumsPath?: string;
  signaturePath?: string;
}

export interface PmpInstallExtensionStepV1 extends PmpInstallPlanStepBaseV1 {
  kind: 'install-extension';
  pluginId: string;
  versionRange?: string;
  manifestPath: string;
  source: PmpInstallPlanSourceV1;
  hostTargets?: PxpManifestV2['hostTargets'];
  capabilities?: CapabilityRequirement[];
}

export interface PmpInstallResourceStepV1 extends PmpInstallPlanStepBaseV1 {
  kind: 'install-resource';
  resourceId: string;
  resourceType: 'shader-pack' | 'theme-pack' | 'profile-pack' | 'variant-preset' | 'resource-pack';
  versionRange?: string;
  source: PmpInstallPlanSourceV1;
}

export interface PmpRefreshPluginRegistriesStepV1 extends PmpInstallPlanStepBaseV1 {
  kind: 'refresh-plugin-registries';
}

export interface PmpApplyThemeStepV1 extends PmpInstallPlanStepBaseV1 {
  kind: 'apply-theme';
  source: PmpInstallPlanSourceV1;
  themePath: string;
}

export interface PmpApplyProfileStepV1 extends PmpInstallPlanStepBaseV1 {
  kind: 'apply-profile';
  source: PmpInstallPlanSourceV1;
  profilePath: string;
  applyTheme?: boolean;
  applyMagnets?: boolean;
}

export interface PmpApplySpaceLayoutStepV1 extends PmpInstallPlanStepBaseV1 {
  kind: 'apply-space-layout';
  source: PmpInstallPlanSourceV1;
  profilePath: string;
  mode: PmpExperiencePackSpaceApplyMode;
}

export interface PmpReportStepV1 extends PmpInstallPlanStepBaseV1 {
  kind: 'report';
  diagnostics: PmpInstallPlanDiagnosticV1[];
}

export type PmpInstallPlanStepV1 =
  | PmpVerifyIntegrityStepV1
  | PmpInstallExtensionStepV1
  | PmpInstallResourceStepV1
  | PmpRefreshPluginRegistriesStepV1
  | PmpApplyThemeStepV1
  | PmpApplyProfileStepV1
  | PmpApplySpaceLayoutStepV1
  | PmpReportStepV1;

/**
 * Host-side package import plan.
 *
 * Parsers for extension-pack, experience-pack, and future registry downloads should
 * produce this shape before anything mutates installed plugins, resources, theme,
 * profile, or space layout. Install plans do not register runtime contributions
 * directly; extension runtime state still enters through manifest-v2 install.
 */
export interface PmpInstallPlanV1 {
  formatVersion: PmpInstallPlanFormatVersion;
  id: string;
  status: PmpInstallPlanStatus;
  source: PmpInstallPlanPackageSourceV1;
  summary: PmpInstallPlanSummaryV1;
  steps: PmpInstallPlanStepV1[];
  dependencies?: PmpInstallPlanDependencyV1[];
  reviewItems?: PmpInstallPlanReviewItemV1[];
  diagnostics?: PmpInstallPlanDiagnosticV1[];
  createdAt?: string;
}
