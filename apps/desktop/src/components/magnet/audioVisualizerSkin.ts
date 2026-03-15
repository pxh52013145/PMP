import type { MagnetVariantPreset } from './shared/magnetVariantCatalog';
import { readEnumProp, readStringProp } from './shared/skinPropUtils';

const AUDIO_VISUALIZER_DENSITIES = ['sparse', 'balanced', 'dense'] as const;
const AUDIO_VISUALIZER_ENERGY_PROFILES = ['soft', 'balanced', 'bright'] as const;
const AUDIO_VISUALIZER_BACKDROPS = ['none', 'soft', 'strong'] as const;

export type AudioVisualizerDensity = (typeof AUDIO_VISUALIZER_DENSITIES)[number];
export type AudioVisualizerEnergyProfile = (typeof AUDIO_VISUALIZER_ENERGY_PROFILES)[number];
export type AudioVisualizerBackdropMode = (typeof AUDIO_VISUALIZER_BACKDROPS)[number];

export interface AudioVisualizerSkinProps {
  density: AudioVisualizerDensity;
  energyProfile: AudioVisualizerEnergyProfile;
  backdrop: AudioVisualizerBackdropMode;
  fallbackAccentColor?: string;
}

export function parseAudioVisualizerSkinProps(value: unknown): AudioVisualizerSkinProps {
  return {
    density: readEnumProp(value, 'density', AUDIO_VISUALIZER_DENSITIES, 'balanced'),
    energyProfile: readEnumProp(value, 'energyProfile', AUDIO_VISUALIZER_ENERGY_PROFILES, 'balanced'),
    backdrop: readEnumProp(value, 'backdrop', AUDIO_VISUALIZER_BACKDROPS, 'soft'),
    fallbackAccentColor: readStringProp(value, 'fallbackAccentColor'),
  };
}

export const AUDIO_VISUALIZER_VARIANT_PRESETS = [
  {
    id: 'default',
    labelKey: 'magnet.variants.audio-visualizer.default.label',
    descriptionKey: 'magnet.variants.audio-visualizer.default.description',
  },
  {
    id: 'dense-halo',
    labelKey: 'magnet.variants.audio-visualizer.dense-halo.label',
    descriptionKey: 'magnet.variants.audio-visualizer.dense-halo.description',
    props: {
      density: 'dense',
      energyProfile: 'bright',
      backdrop: 'soft',
    },
  },
  {
    id: 'minimal',
    labelKey: 'magnet.variants.audio-visualizer.minimal.label',
    descriptionKey: 'magnet.variants.audio-visualizer.minimal.description',
    props: {
      density: 'sparse',
      energyProfile: 'soft',
      backdrop: 'none',
    },
  },
] satisfies readonly MagnetVariantPreset<AudioVisualizerSkinProps>[];
