import type {
  ActivationEventDescriptor,
  PxpManifestV2,
} from '@pixel-matrix/plugin-platform-contracts';
import type { InstalledHostExtensionRecord } from './extensions';

export type InstalledExtensionActivationTrigger =
  | { cause: 'startup' }
  | { cause: 'command'; commandId: string }
  | { cause: 'view'; viewId: string }
  | { cause: 'capability'; capabilityId: string }
  | { cause: 'host'; hostEventId: string }
  | { cause: 'file'; fileType: string };

type ActivationEventMatch =
  | { kind: 'startup' }
  | { kind: 'command'; value: string }
  | { kind: 'view'; value: string }
  | { kind: 'capability'; value: string }
  | { kind: 'host'; value: string }
  | { kind: 'file'; value: string }
  | { kind: 'unknown'; value: string };

function readManifest(input: InstalledHostExtensionRecord | PxpManifestV2): PxpManifestV2 {
  return 'manifest' in input ? input.manifest : input;
}

function normalizeNonEmptyString(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized.length > 0 ? normalized : null;
}

function normalizeActivationEvent(
  event: ActivationEventDescriptor
): ActivationEventMatch | null {
  if (event === 'onStartup') {
    return { kind: 'startup' };
  }

  if (typeof event === 'string') {
    const normalized = event.trim();
    if (!normalized) return null;

    if (normalized.startsWith('onCommand:')) {
      return {
        kind: 'command',
        value: normalized.slice('onCommand:'.length),
      };
    }

    if (normalized.startsWith('onView:')) {
      return {
        kind: 'view',
        value: normalized.slice('onView:'.length),
      };
    }

    if (normalized.startsWith('onCapability:')) {
      return {
        kind: 'capability',
        value: normalized.slice('onCapability:'.length),
      };
    }

    if (normalized.startsWith('onHost:')) {
      return {
        kind: 'host',
        value: normalized.slice('onHost:'.length),
      };
    }

    if (normalized.startsWith('onFile:')) {
      return {
        kind: 'file',
        value: normalized.slice('onFile:'.length),
      };
    }

    return {
      kind: 'unknown',
      value: normalized,
    };
  }

  const kind = normalizeNonEmptyString(event?.kind);
  if (!kind) return null;

  return {
    kind: 'unknown',
    value: kind,
  };
}

function matchesScopedActivation(value: string, expected: string): boolean {
  return value === '*' || value === expected;
}

export function listInstalledExtensionActivationEvents(
  input: InstalledHostExtensionRecord | PxpManifestV2
): ActivationEventMatch[] {
  return (readManifest(input).activationEvents ?? [])
    .map((event) => normalizeActivationEvent(event))
    .filter((event): event is ActivationEventMatch => event !== null);
}

export function hasInstalledExtensionStartupActivation(
  input: InstalledHostExtensionRecord | PxpManifestV2
): boolean {
  return listInstalledExtensionActivationEvents(input).some((event) => event.kind === 'startup');
}

export function buildInstalledExtensionActivationViewId(options: {
  pluginId: string;
  surfaceKind:
    | 'magnet'
    | 'settings'
    | 'page'
    | 'visualizer'
    | 'window'
    | 'overlay'
    | 'desktop-widget';
  surfaceId?: string | null;
}): string {
  if (options.surfaceKind === 'magnet') {
    return options.pluginId;
  }

  return normalizeNonEmptyString(options.surfaceId) ?? options.pluginId;
}

export function isInstalledExtensionActivationAllowed(
  input: InstalledHostExtensionRecord | PxpManifestV2,
  trigger: InstalledExtensionActivationTrigger
): boolean {
  const events = listInstalledExtensionActivationEvents(input);
  if (events.length === 0) {
    return true;
  }

  if (events.some((event) => event.kind === 'startup')) {
    return true;
  }

  switch (trigger.cause) {
    case 'startup':
      return false;
    case 'command':
      return events.some(
        (event) =>
          event.kind === 'command' &&
          matchesScopedActivation(event.value, trigger.commandId)
      );
    case 'view':
      return events.some(
        (event) =>
          event.kind === 'view' && matchesScopedActivation(event.value, trigger.viewId)
      );
    case 'capability':
      return events.some(
        (event) =>
          event.kind === 'capability' &&
          matchesScopedActivation(event.value, trigger.capabilityId)
      );
    case 'host':
      return events.some(
        (event) =>
          event.kind === 'host' &&
          matchesScopedActivation(event.value, trigger.hostEventId)
      );
    case 'file':
      return events.some(
        (event) =>
          event.kind === 'file' && matchesScopedActivation(event.value, trigger.fileType)
      );
    default: {
      const exhaustive: never = trigger;
      return exhaustive;
    }
  }
}

export function readInstalledExtensionActivationError(
  input: InstalledHostExtensionRecord | PxpManifestV2,
  trigger: InstalledExtensionActivationTrigger
): string | null {
  if (isInstalledExtensionActivationAllowed(input, trigger)) {
    return null;
  }

  const manifest = readManifest(input);
  const pluginId = manifest.identity.id;

  switch (trigger.cause) {
    case 'startup':
      return `Extension "${pluginId}" does not declare activation event "onStartup"`;
    case 'command':
      return `Extension "${pluginId}" does not declare activation event "onCommand:${trigger.commandId}"`;
    case 'view':
      return `Extension "${pluginId}" does not declare activation event "onView:${trigger.viewId}"`;
    case 'capability':
      return `Extension "${pluginId}" does not declare activation event "onCapability:${trigger.capabilityId}"`;
    case 'host':
      return `Extension "${pluginId}" does not declare activation event "onHost:${trigger.hostEventId}"`;
    case 'file':
      return `Extension "${pluginId}" does not declare activation event "onFile:${trigger.fileType}"`;
    default: {
      const exhaustive: never = trigger;
      return String(exhaustive);
    }
  }
}

export function assertInstalledExtensionActivationAllowed(
  input: InstalledHostExtensionRecord | PxpManifestV2,
  trigger: InstalledExtensionActivationTrigger
): void {
  const message = readInstalledExtensionActivationError(input, trigger);
  if (message) {
    throw new Error(message);
  }
}
