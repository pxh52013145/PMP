import type {
  Magnet,
  MagnetBoundsAlignConfig,
  MagnetBoundsDockConfig,
  MagnetChromeConfig,
  MagnetInsetConfig,
} from '../../types/pixel';

export interface SingleControlLayoutPresetOptions {
  boundsInset?: MagnetInsetConfig;
  boundsOutset?: MagnetInsetConfig;
  chromeInset?: MagnetInsetConfig;
}

export interface DockedSingleControlLayoutPresetOptions extends SingleControlLayoutPresetOptions {
  dock?: MagnetBoundsDockConfig;
}

export interface PanelLayoutPresetOptions {
  boundsInset?: MagnetInsetConfig;
  boundsOutset?: MagnetInsetConfig;
  boundsAlign?: MagnetBoundsAlignConfig;
  chromeInset?: MagnetInsetConfig;
}

type MagnetLayoutPreset = Pick<Magnet, 'boundsMode' | 'boundsDock' | 'boundsInset' | 'boundsOutset' | 'boundsAlign' | 'chrome'>;

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
    ...(options.boundsOutset ? { boundsOutset: options.boundsOutset } : {}),
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
    ...(options.boundsOutset ? { boundsOutset: options.boundsOutset } : {}),
    ...(options.chromeInset ? { chrome: buildChromeConfig(options.chromeInset) } : {}),
  };
}

export function createPanelLayoutPreset(options: PanelLayoutPresetOptions = {}): MagnetLayoutPreset {
  return {
    ...(options.boundsInset ? { boundsInset: options.boundsInset } : {}),
    ...(options.boundsOutset ? { boundsOutset: options.boundsOutset } : {}),
    ...(options.boundsAlign ? { boundsAlign: options.boundsAlign } : {}),
    ...(options.chromeInset ? { chrome: buildChromeConfig(options.chromeInset) } : {}),
  };
}
