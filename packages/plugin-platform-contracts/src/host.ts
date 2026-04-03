import type {
  ExtensionDefaultAnchorDescriptor,
  ExtensionVariantDescriptor,
} from './manifest';
import type {
  PageContributionDescriptor,
  SettingsPanelContributionDescriptor,
  VisualizerContributionDescriptor,
  WindowContributionDescriptor,
} from './contributions';

export interface HostCapabilityInfo {
  id: string;
  version: string;
  permission?: string;
  description?: string;
  experimental?: boolean;
}

export interface HostCapabilityInvokeContext {
  pluginId: string;
  hostLabel: string;
  permissions: ReadonlySet<string>;
}

export interface HostCapabilityInvokeRequest {
  method: string;
  payload: unknown;
  context: HostCapabilityInvokeContext;
}

export interface HostCapabilityError {
  code: string;
  message: string;
  retryable?: boolean;
  details?: unknown;
}

export type HostCapabilityResult<T = unknown> =
  | {
      ok: true;
      data: T;
    }
  | {
      ok: false;
      error: HostCapabilityError;
    };

export interface PmpHostCapabilityPackDescriptor {
  hostId: 'pmp';
  packVersion: string;
  capabilityFamilies: string[];
  coreCompatibility: string;
}

export const PMP_HOST_CAPABILITY_FAMILIES = [
  'host.pmp.navigation',
  'host.pmp.shell.window',
  'host.pmp.shell.menu',
  'host.pmp.shell.context-menu',
  'host.pmp.shell.tray',
  'host.pmp.shell.status-item',
  'host.pmp.magnets.catalog',
  'host.pmp.magnets.layout',
  'host.pmp.magnets.renderer',
  'host.pmp.audio-engine.playback',
  'host.pmp.audio-engine.analysis',
  'host.pmp.audio-engine.input',
  'host.pmp.music-platform.catalog',
  'host.pmp.music-platform.search',
  'host.pmp.music-platform.prepare',
  'host.pmp.connector-auth',
  'host.pmp.theme-bindings',
  'host.pmp.library-fields',
  'host.pmp.storage.config',
  'host.pmp.storage.durable-text',
  'host.pmp.storage.sync',
  'host.pmp.keybinding-context',
  'host.pmp.i18n',
  'host.pmp.telemetry',
] as const;

export type PmpHostCapabilityFamilyId = (typeof PMP_HOST_CAPABILITY_FAMILIES)[number];

export const PMP_FOUNDATION_CAPABILITY_COMPAT_MAP = {
  'foundation.capability-registry': 'core.capability-registry',
  'foundation.audio-input-adapter': 'host.pmp.audio-engine.input',
  'foundation.ai-adapter': 'foundation.ai-adapter',
  'foundation.desktop-pet-runtime': 'foundation.desktop-pet-runtime',
  'foundation.voice-training-runtime': 'foundation.voice-training-runtime',
} as const;

export type PmpFoundationCapabilityId = keyof typeof PMP_FOUNDATION_CAPABILITY_COMPAT_MAP;

export interface PmpHostMagnetContributionDescriptor {
  defaultAnchor?: ExtensionDefaultAnchorDescriptor;
  defaultStyle?: Record<string, unknown>;
  defaultVariant?: string;
  variants?: ExtensionVariantDescriptor[];
}

export interface PmpHostManifestContributionDescriptor {
  pages?: PageContributionDescriptor[];
  windows?: WindowContributionDescriptor[];
  settingsPanels?: SettingsPanelContributionDescriptor[];
  visualizers?: VisualizerContributionDescriptor[];
  magnets?: PmpHostMagnetContributionDescriptor;
}
