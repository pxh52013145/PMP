import type { MusicPlatformWorkspaceDescriptor } from './musicPlatformWorkspace';

export type ContributionSource = 'builtin' | 'plugin' | 'runtime';

export type ContributionMetadata = Record<string, unknown>;

export interface OrderedContributionDescriptor {
  id: string;
  title: string;
  description?: string;
  group?: string;
  order?: number;
  tags?: string[];
  metadata?: ContributionMetadata;
}

export interface PageContributionDescriptor extends OrderedContributionDescriptor {
  kind: 'page';
}

export interface WindowContributionDescriptor extends OrderedContributionDescriptor {
  kind: 'window';
  width?: number;
  height?: number;
}

export type ShellSurfaceType = 'overlay' | 'desktop-widget';

export type ShellSurfacePointerPolicy = 'capture-input' | 'passthrough';

export interface ShellSurfaceContributionDescriptor extends OrderedContributionDescriptor {
  kind: 'shell-surface';
  surfaceType: ShellSurfaceType;
  width?: number;
  height?: number;
  alwaysOnTop?: boolean;
  focusable?: boolean;
  dismissOnEscape?: boolean;
  pointerPolicy?: ShellSurfacePointerPolicy;
}

export interface SettingsPanelContributionDescriptor extends OrderedContributionDescriptor {
  kind: 'settings-panel';
}

export interface VisualizerContributionDescriptor extends OrderedContributionDescriptor {
  kind: 'visualizer';
  inputs?: string[];
}

export interface CommandContributionDescriptor extends OrderedContributionDescriptor {
  kind: 'command';
}

export interface MusicPlatformWorkspaceContributionDescriptor
  extends OrderedContributionDescriptor {
  kind: 'music-platform-workspace';
  connectorId?: string;
  workspace: MusicPlatformWorkspaceDescriptor;
}

export interface KeybindingContributionDescriptor {
  kind: 'keybinding';
  id: string;
  key: string;
  command: string;
  when?: string;
  args?: unknown;
  weight?: number;
  metadata?: ContributionMetadata;
}

export type ExtensionContributionDescriptor =
  | PageContributionDescriptor
  | WindowContributionDescriptor
  | ShellSurfaceContributionDescriptor
  | SettingsPanelContributionDescriptor
  | VisualizerContributionDescriptor
  | CommandContributionDescriptor
  | MusicPlatformWorkspaceContributionDescriptor
  | KeybindingContributionDescriptor;

export type {
  CoreAnalyzerContributionDescriptor,
  CoreBackgroundServiceContributionDescriptor,
  CoreCommandContributionDescriptor,
  CoreConnectorContributionDescriptor,
  CoreContributionBase,
  CoreContributionBuckets,
  CoreContributionDescriptor,
  CoreFilesystemContributionDescriptor,
  CoreKeybindingContributionDescriptor,
  CoreMenuContributionDescriptor,
  CoreProtocolHandlerContributionDescriptor,
  CoreProviderContributionDescriptor,
  CoreTaskContributionDescriptor,
  CoreThemeContributionDescriptor,
  CoreViewContributionDescriptor,
  LocalizedTextDescriptor,
} from './core';
