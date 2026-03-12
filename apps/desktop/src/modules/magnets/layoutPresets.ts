import type { Magnet, MagnetBoundsDockConfig, MagnetChromeConfig, MagnetInsetConfig } from '../../types/pixel';

export interface SingleControlLayoutPresetOptions {
  boundsInset?: MagnetInsetConfig;
  chromeInset?: MagnetInsetConfig;
}

export interface DockedSingleControlLayoutPresetOptions extends SingleControlLayoutPresetOptions {
  dock?: MagnetBoundsDockConfig;
}

export interface PanelLayoutPresetOptions {
  boundsInset?: MagnetInsetConfig;
  chromeInset?: MagnetInsetConfig;
}

type MagnetLayoutPreset = Pick<Magnet, 'boundsMode' | 'boundsDock' | 'boundsInset' | 'chrome'>;

function buildChromeConfig(inset?: MagnetInsetConfig): MagnetChromeConfig | undefined {
  if (!inset) return undefined;
  return { inset };
}

export function createCenteredSingleControlLayoutPreset(
  options: SingleControlLayoutPresetOptions = {}
): MagnetLayoutPreset {
  return {
    boundsMode: 'centered',
    ...(options.boundsInset ? { boundsInset: options.boundsInset } : {}),
    ...(options.chromeInset ? { chrome: buildChromeConfig(options.chromeInset) } : {}),
  };
}

export function createDockedSingleControlLayoutPreset(
  options: DockedSingleControlLayoutPresetOptions = {}
): MagnetLayoutPreset {
  return {
    boundsMode: 'docked',
    ...(options.dock ? { boundsDock: options.dock } : {}),
    ...(options.boundsInset ? { boundsInset: options.boundsInset } : {}),
    ...(options.chromeInset ? { chrome: buildChromeConfig(options.chromeInset) } : {}),
  };
}

export function createPanelLayoutPreset(options: PanelLayoutPresetOptions = {}): MagnetLayoutPreset {
  return {
    ...(options.boundsInset ? { boundsInset: options.boundsInset } : {}),
    ...(options.chromeInset ? { chrome: buildChromeConfig(options.chromeInset) } : {}),
  };
}

