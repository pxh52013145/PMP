import type { NavigationPageData, NavigationPageType } from './navigation';

export type ContributionSource = 'builtin' | 'plugin' | 'runtime';

export type PageContribution = {
  kind: 'page';
  id: NavigationPageType;
  title: string;
  render: (page: NavigationPageData) => unknown;
  source?: ContributionSource;
  order?: number;
  group?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
};

export type WindowContribution = {
  kind: 'window';
  id: string;
  title: string;
  label: string;
  route?: string;
  open: (options?: Record<string, unknown>) => Promise<void>;
  close?: () => Promise<void>;
  source?: ContributionSource;
  metadata?: Record<string, unknown>;
};

export type SettingsPanelContribution = {
  kind: 'settings-panel';
  id: string;
  title: string;
  description?: string;
  render: () => unknown;
  source?: ContributionSource;
  order?: number;
  group?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
};

export type VisualizerContribution = {
  kind: 'visualizer';
  id: string;
  title: string;
  description?: string;
  inputs?: string[];
  open: (options?: Record<string, unknown>) => void | Promise<void>;
  source?: ContributionSource;
  order?: number;
  group?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
};

export type CommandContribution = {
  kind: 'command';
  id: string;
  title: string;
  description?: string;
  run: (args?: unknown) => void | Promise<void>;
  source?: ContributionSource;
  order?: number;
  group?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
};

export type WorkbenchContribution = {
  kind: 'workbench';
  id: string;
  title: string;
  render: () => unknown;
  source?: ContributionSource;
  order?: number;
  group?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
};

export type WorkbenchLayoutSlots = {
  navigation: unknown;
  content: unknown;
};

export type WorkbenchLayoutContribution = {
  kind: 'workbench-layout';
  id: string;
  title: string;
  render: (slots: WorkbenchLayoutSlots) => unknown;
  source?: ContributionSource;
  order?: number;
  group?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
};

export type WorkbenchNavigationContribution = {
  kind: 'workbench-navigation';
  id: string;
  title: string;
  render: () => unknown;
  source?: ContributionSource;
  order?: number;
  group?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
};

export type WorkbenchPageContainerContribution = {
  kind: 'workbench-page-container';
  id: string;
  title: string;
  render: () => unknown;
  source?: ContributionSource;
  order?: number;
  group?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
};

export type DesktopContribution =
  | PageContribution
  | WindowContribution
  | SettingsPanelContribution
  | VisualizerContribution
  | CommandContribution
  | WorkbenchContribution
  | WorkbenchLayoutContribution
  | WorkbenchNavigationContribution
  | WorkbenchPageContainerContribution;
