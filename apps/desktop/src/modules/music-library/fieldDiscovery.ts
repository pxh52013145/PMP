import { Track } from '../../services/audio';
import {
  getMusicLibraryBaseFieldCapability,
  registerMusicLibraryBaseFieldCapabilities,
  type MusicLibraryExtensionFieldCapabilityInput,
} from './fieldCapabilities';
import { isMusicLibraryDynamicTrackFieldExcluded } from './trackProjection';

const DEFAULT_TRACK_SAMPLE_LIMIT = 200;

type FieldObservation = {
  sawNumeric: boolean;
  sawDate: boolean;
  sawBoolean: boolean;
  sawText: boolean;
  sawNonNumericText: boolean;
  sawArray: boolean;
};

function isFiniteNumericString(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed);
}

function humanizeMusicLibraryFieldId(field: string): string {
  return field
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/[_\-.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(' ');
}

function observeMusicLibraryFieldValue(observation: FieldObservation, value: unknown): void {
  if (typeof value === 'number') {
    if (Number.isFinite(value)) {
      observation.sawNumeric = true;
    }
    return;
  }

  if (value instanceof Date) {
    if (Number.isFinite(value.getTime())) {
      observation.sawDate = true;
    }
    return;
  }

  if (typeof value === 'boolean') {
    observation.sawBoolean = true;
    return;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    observation.sawText = true;
    if (isFiniteNumericString(trimmed)) {
      observation.sawNumeric = true;
    } else {
      observation.sawNonNumericText = true;
    }
    return;
  }

  if (Array.isArray(value)) {
    const compacted = value.filter(
      (item) => typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean'
    );
    if (compacted.length > 0) {
      observation.sawArray = true;
      observation.sawText = true;
    }
  }
}

function createEmptyObservation(): FieldObservation {
  return {
    sawNumeric: false,
    sawDate: false,
    sawBoolean: false,
    sawText: false,
    sawNonNumericText: false,
    sawArray: false,
  };
}

function shouldDiscoverMusicLibraryTrackField(key: string): boolean {
  if (!key.trim()) return false;
  if (isMusicLibraryDynamicTrackFieldExcluded(key)) return false;
  return getMusicLibraryBaseFieldCapability(key) == null;
}

function inferMusicLibraryFieldKind(observation: FieldObservation): 'text' | 'number' {
  if (observation.sawBoolean || observation.sawArray || observation.sawNonNumericText) {
    return 'text';
  }

  if (observation.sawNumeric || observation.sawDate) {
    return 'number';
  }

  return 'text';
}

export function discoverMusicLibraryFieldCapabilitiesFromTracks(
  tracks: Track[],
  options?: { sampleLimit?: number }
): MusicLibraryExtensionFieldCapabilityInput[] {
  if (tracks.length === 0) {
    return [];
  }

  const sampleLimit =
    typeof options?.sampleLimit === 'number' && Number.isFinite(options.sampleLimit)
      ? Math.max(1, Math.floor(options.sampleLimit))
      : DEFAULT_TRACK_SAMPLE_LIMIT;

  const observations = new Map<string, FieldObservation>();

  for (const track of tracks.slice(0, sampleLimit)) {
    for (const [key, value] of Object.entries(track as unknown as Record<string, unknown>)) {
      if (!shouldDiscoverMusicLibraryTrackField(key)) {
        continue;
      }

      let observation = observations.get(key);
      if (!observation) {
        observation = createEmptyObservation();
        observations.set(key, observation);
      }

      observeMusicLibraryFieldValue(observation, value);
    }
  }

  return [...observations.entries()]
    .filter(([, observation]) => {
      return (
        observation.sawNumeric ||
        observation.sawDate ||
        observation.sawBoolean ||
        observation.sawText ||
        observation.sawArray
      );
    })
    .map(([key, observation]) => ({
      id: key,
      label: humanizeMusicLibraryFieldId(key),
      kind: inferMusicLibraryFieldKind(observation),
      filterable: true,
      sortable: true,
      groupable: true,
      trackKey: key,
    }))
    .sort((left, right) => left.label.localeCompare(right.label, undefined, { sensitivity: 'base' }));
}

export function registerMusicLibraryDiscoveredFieldCapabilitiesFromTracks(
  tracks: Track[],
  options?: { sampleLimit?: number }
): MusicLibraryExtensionFieldCapabilityInput[] {
  const definitions = discoverMusicLibraryFieldCapabilitiesFromTracks(tracks, options);
  if (definitions.length > 0) {
    registerMusicLibraryBaseFieldCapabilities(definitions);
  }
  return definitions;
}
