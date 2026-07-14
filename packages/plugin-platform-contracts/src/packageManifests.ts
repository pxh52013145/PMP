import type { DependencyDescriptor, IntegrityDescriptor, PxpManifestV2 } from './core';

export type PmpImplementedPackageType =
  | 'manifest-v2-project'
  | 'extension-pack'
  | 'experience-pack'
  | 'theme'
  | 'theme-pack'
  | 'profile-pack'
  | 'variant-preset'
  | 'shader-pack'
  | 'platform-pack';

export type PmpDraftPackageType = 'resource-pack';

export type PmpLegacyPackageType = 'magnet-plugin';

export type PmpKnownPackageType =
  | PmpImplementedPackageType
  | PmpDraftPackageType
  | PmpLegacyPackageType;

export type PmpPackageStatus = 'implemented' | 'draft' | 'legacy';

export type PmpRegistrationTarget =
  | 'extension'
  | 'magnet'
  | 'appearance'
  | 'profile'
  | 'resource'
  | 'experience'
  | 'development';

export type PmpRegistrationMode = 'install' | 'register' | 'apply' | 'legacy';

export interface PmpPackageBoundaryDescriptor {
  type: PmpKnownPackageType;
  status: PmpPackageStatus;
  registrationTarget: PmpRegistrationTarget;
  registrationMode: PmpRegistrationMode;
  extension: string | null;
  manifestFile: string | null;
  ownsRuntime: boolean;
  ownsUserProfileState: boolean;
  ownsSharedResources: boolean;
  notes: string;
}

export const PMP_PACKAGE_BOUNDARIES = [
  {
    type: 'manifest-v2-project',
    status: 'implemented',
    registrationTarget: 'extension',
    registrationMode: 'install',
    extension: null,
    manifestFile: 'manifest.v2.json',
    ownsRuntime: true,
    ownsUserProfileState: false,
    ownsSharedResources: false,
    notes:
      'Current extv2 install source. The desktop installer reads a directory or manifest.v2.json.',
  },
  {
    type: 'extension-pack',
    status: 'implemented',
    registrationTarget: 'extension',
    registrationMode: 'install',
    extension: '.pmpe',
    manifestFile: 'manifest.json',
    ownsRuntime: false,
    ownsUserProfileState: false,
    ownsSharedResources: false,
    notes:
      'Single-plugin zip wrapper. It unwraps to a manifest-v2 project and does not define a new runtime.',
  },
  {
    type: 'experience-pack',
    status: 'implemented',
    registrationTarget: 'experience',
    registrationMode: 'apply',
    extension: '.pmpex',
    manifestFile: 'manifest.json',
    ownsRuntime: false,
    ownsUserProfileState: true,
    ownsSharedResources: false,
    notes:
      'Local composition pack for plugins, resources, theme, profile, and space layout install plans.',
  },
  {
    type: 'theme',
    status: 'implemented',
    registrationTarget: 'appearance',
    registrationMode: 'apply',
    extension: '.pmpt',
    manifestFile: null,
    ownsRuntime: false,
    ownsUserProfileState: false,
    ownsSharedResources: false,
    notes: 'Single theme JSON document. It must remain data-only.',
  },
  {
    type: 'theme-pack',
    status: 'implemented',
    registrationTarget: 'appearance',
    registrationMode: 'register',
    extension: '.pmpk',
    manifestFile: 'manifest.json',
    ownsRuntime: false,
    ownsUserProfileState: false,
    ownsSharedResources: false,
    notes: 'Theme bundle. Identified by manifest.type === "theme-pack".',
  },
  {
    type: 'profile-pack',
    status: 'implemented',
    registrationTarget: 'profile',
    registrationMode: 'apply',
    extension: '.pmpk',
    manifestFile: 'manifest.json',
    ownsRuntime: false,
    ownsUserProfileState: true,
    ownsSharedResources: false,
    notes: 'Theme/profile/layout bundle. Identified by manifest.type === "profile-pack".',
  },
  {
    type: 'variant-preset',
    status: 'implemented',
    registrationTarget: 'appearance',
    registrationMode: 'register',
    extension: '.pmpv',
    manifestFile: null,
    ownsRuntime: false,
    ownsUserProfileState: false,
    ownsSharedResources: false,
    notes: 'Renderer variant preset JSON. Current desktop contract is fragment-first.',
  },
  {
    type: 'shader-pack',
    status: 'implemented',
    registrationTarget: 'resource',
    registrationMode: 'register',
    extension: '.pmps',
    manifestFile: 'manifest.json',
    ownsRuntime: false,
    ownsUserProfileState: false,
    ownsSharedResources: true,
    notes: 'Shader resource pack containing shader metadata and fragment source.',
  },
  {
    type: 'resource-pack',
    status: 'draft',
    registrationTarget: 'resource',
    registrationMode: 'register',
    extension: null,
    manifestFile: 'manifest.json',
    ownsRuntime: false,
    ownsUserProfileState: false,
    ownsSharedResources: true,
    notes: 'Future umbrella for large shared assets such as WASM, models, and media bundles.',
  },
  {
    type: 'platform-pack',
    status: 'implemented',
    registrationTarget: 'development',
    registrationMode: 'install',
    extension: null,
    manifestFile: 'manifest.json',
    ownsRuntime: true,
    ownsUserProfileState: false,
    ownsSharedResources: false,
    notes: 'Music platform development lane. It is not the generic plugin packaging format.',
  },
  {
    type: 'magnet-plugin',
    status: 'legacy',
    registrationTarget: 'magnet',
    registrationMode: 'legacy',
    extension: '.pmpm',
    manifestFile: 'manifest.json',
    ownsRuntime: true,
    ownsUserProfileState: false,
    ownsSharedResources: false,
    notes: 'Legacy PMPM community format. New plugin development should target manifest-v2.',
  },
] as const satisfies readonly PmpPackageBoundaryDescriptor[];

export interface PmpPackageMetadataV1 {
  id: string;
  name: string;
  version: string;
  publisher?: string;
  author?: string;
  description?: string;
  tags?: string[];
  homepage?: string;
  repository?: string;
}

export interface PmpChecksumsV1 {
  formatVersion: '1.0';
  algorithm: 'sha256';
  files: Record<string, string>;
}

export interface PmpSignatureDescriptorV1 {
  format: string;
  path: string;
  keyId?: string;
}

export interface PmpPackageSourceEmbeddedV1 {
  kind: 'embedded';
  path: string;
  sha256?: string;
}

export interface PmpPackageSourceRegistryV1 {
  kind: 'registry';
  registryUrl?: string;
  packageId: string;
  versionRange?: string;
  sha256?: string;
}

export interface PmpPackageSourceUrlV1 {
  kind: 'url';
  url: string;
  sha256: string;
  signature?: PmpSignatureDescriptorV1;
}

export type PmpPackageSourceV1 =
  | PmpPackageSourceEmbeddedV1
  | PmpPackageSourceRegistryV1
  | PmpPackageSourceUrlV1;

export interface PmpExtensionPackManifestV1 {
  formatVersion: '1.0';
  type: 'extension-pack';
  metadata: PmpPackageMetadataV1;
  entry: {
    manifest: string;
  };
  checksums?: PmpChecksumsV1;
  integrity?: IntegrityDescriptor;
}

export interface PmpExperiencePackPluginDependencyV1 {
  id: string;
  versionRange?: string;
  required?: boolean;
  source?: PmpPackageSourceV1;
}

export interface PmpExperiencePackResourceDependencyV1 {
  id: string;
  kind: 'shader-pack' | 'theme-pack' | 'profile-pack' | 'variant-preset' | 'resource-pack';
  versionRange?: string;
  required?: boolean;
  source?: PmpPackageSourceV1;
}

export type PmpExperiencePackSpaceApplyMode =
  | 'prompt'
  | 'create-new-spaces'
  | 'map-one-space'
  | 'replace-all';

export interface PmpExperiencePackProfileEntryV1 {
  path: string;
  apply?: {
    theme?: boolean;
    magnets?: boolean;
    spaces?: PmpExperiencePackSpaceApplyMode;
  };
}

export interface PmpExperiencePackManifestV1 {
  formatVersion: '1.0';
  type: 'experience-pack';
  metadata: PmpPackageMetadataV1;
  hostTargets?: PxpManifestV2['hostTargets'];
  dependencies?: DependencyDescriptor[];
  plugins?: PmpExperiencePackPluginDependencyV1[];
  resources?: PmpExperiencePackResourceDependencyV1[];
  profile?: PmpExperiencePackProfileEntryV1;
  checksums?: PmpChecksumsV1;
  signature?: PmpSignatureDescriptorV1;
}
