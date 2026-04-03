import type { CapabilityPermission } from './capabilities';
import type {
  CommandContributionDescriptor,
  KeybindingContributionDescriptor,
  PageContributionDescriptor,
  SettingsPanelContributionDescriptor,
  VisualizerContributionDescriptor,
  WindowContributionDescriptor,
} from './contributions';

export interface ExtensionManifestMetadata {
  id: string;
  name: string;
  version: string;
  author?: string;
  description?: string;
  tags?: string[];
}

export interface ExtensionVariantDescriptor {
  id: string;
  label: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface ExtensionDefaultAnchorDescriptor {
  type?: 'single' | 'range';
  coordinates?: Array<{ x: number; y: number }>;
}

export interface ExtensionDisplayDescriptor {
  defaultAnchor?: ExtensionDefaultAnchorDescriptor;
  defaultStyle?: Record<string, unknown>;
  defaultVariant?: string;
  variants?: ExtensionVariantDescriptor[];
}

export interface ExtensionContributionBuckets {
  pages?: PageContributionDescriptor[];
  windows?: WindowContributionDescriptor[];
  commands?: CommandContributionDescriptor[];
  settingsPanels?: SettingsPanelContributionDescriptor[];
  visualizers?: VisualizerContributionDescriptor[];
  keybindings?: KeybindingContributionDescriptor[];
}

export interface ExtensionManifestCore<
  TType extends string = string,
  TContributions extends object = ExtensionContributionBuckets,
> {
  formatVersion: string;
  apiVersion?: string;
  type: TType;
  metadata: ExtensionManifestMetadata;
  entryPoint: string;
  contributions?: TContributions;
  permissions?: CapabilityPermission[];
}

export type {
  ActivationEventDescriptor,
  CompatDescriptor,
  ConfigContributionDescriptor,
  ConfigMigrationDescriptor,
  DependencyDescriptor,
  HostTargetDescriptor,
  InstalledExtensionRecord,
  IntegrityDescriptor,
  LocaleBundleDescriptor,
  ManifestContributionDescriptor,
  PxpManifestV2,
  ResourceBundleDescriptor,
  RuntimeEntryDescriptor,
  TrustHintsDescriptor,
} from './core';
