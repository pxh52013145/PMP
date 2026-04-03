import type {
  CommandContributionDescriptor,
  ContributionSource,
  KeybindingContributionDescriptor,
  PageContributionDescriptor,
  SettingsPanelContributionDescriptor,
  VisualizerContributionDescriptor,
  WindowContributionDescriptor,
} from '@pixel-matrix/plugin-platform-contracts';
import type { NavigationPageData, NavigationPageType } from './navigation';

export type PageContribution = Omit<PageContributionDescriptor, 'kind' | 'id'> & {
  kind: 'page';
  id: NavigationPageType;
  title: string;
  render: (page: NavigationPageData) => unknown;
  source?: ContributionSource;
};

export type WindowContribution = Omit<WindowContributionDescriptor, 'kind'> & {
  kind: 'window';
  id: string;
  title: string;
  label: string;
  route?: string;
  open: (options?: Record<string, unknown>) => Promise<void>;
  close?: () => Promise<void>;
  source?: ContributionSource;
};

export type SettingsPanelContribution = Omit<SettingsPanelContributionDescriptor, 'kind'> & {
  kind: 'settings-panel';
  id: string;
  title: string;
  description?: string;
  render: () => unknown;
  source?: ContributionSource;
};

export type VisualizerContribution = Omit<VisualizerContributionDescriptor, 'kind'> & {
  kind: 'visualizer';
  id: string;
  title: string;
  description?: string;
  inputs?: string[];
  open: (options?: Record<string, unknown>) => void | Promise<void>;
  source?: ContributionSource;
};

export type CommandContribution = Omit<CommandContributionDescriptor, 'kind'> & {
  kind: 'command';
  id: string;
  title: string;
  description?: string;
  run: (args?: unknown) => void | Promise<void>;
  source?: ContributionSource;
};

export type KeybindingContribution = Omit<KeybindingContributionDescriptor, 'kind'> & {
  kind: 'keybinding';
  id: string;
  /** Space-separated chords, each chord is '+' separated. Example: "ctrl+k ctrl+s" */
  key: string;
  /** Target command id */
  command: string;
  /**
   * VSCode-like when-clause (subset).
   * - `key` / `!key`
   * - boolean ops: `!`, `&&`, `||` with parentheses
   * - comparisons: `key == value` / `key != value` (value can be string/number/boolean; unquoted identifiers are treated as strings)
   */
  when?: string;
  args?: unknown;
  source?: ContributionSource;
  /** Priority among defaults; higher weight means later in default ordering. */
  weight?: number;
};

export type DesktopContribution =
  | PageContribution
  | WindowContribution
  | SettingsPanelContribution
  | VisualizerContribution
  | CommandContribution
  | KeybindingContribution;
