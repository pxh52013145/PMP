import type { TelemetryLevel } from '../../contracts/telemetry';
import type { TelemetryService } from './telemetryTypes';

type ConsoleMethodName = 'log' | 'info' | 'warn' | 'error' | 'debug';

type ConsoleTelemetryEntry = {
  moduleId: string;
  component: string | null;
  event: string;
  level: TelemetryLevel;
  message: string | null;
  fields: Record<string, unknown> | null;
};

const CONSOLE_METHODS: readonly ConsoleMethodName[] = ['log', 'info', 'warn', 'error', 'debug'];
const CONSOLE_BRIDGE_QUEUE_LIMIT = 200;
const CONSOLE_ARGS_PREVIEW_LIMIT = 4;
const CONSOLE_PREVIEW_TEXT_LIMIT = 240;

let bridgeInstalled = false;
let bridgeForwardingDepth = 0;
let attachedService: TelemetryService | null = null;
let pendingEntries: ConsoleTelemetryEntry[] = [];

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    if (bridgeInstalled && typeof console !== 'undefined') {
      for (const method of CONSOLE_METHODS) {
        const original = originalConsole[method];
        if (original) {
          console[method] = original;
        }
      }
    }
    bridgeInstalled = false;
    bridgeForwardingDepth = 0;
    attachedService = null;
    pendingEntries = [];
  });
}

const originalConsole: Partial<Record<ConsoleMethodName, (...args: unknown[]) => void>> = {};

function normalizeModuleToken(token: string): string | null {
  const trimmed = token.trim();
  if (!trimmed) return null;
  const kebab = trimmed
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[_\s/]+/g, '-')
    .replace(/[^a-zA-Z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return kebab || null;
}

function truncateText(value: string, limit: number = CONSOLE_PREVIEW_TEXT_LIMIT): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, Math.max(0, limit - 1))}\u2026`;
}

function previewValue(value: unknown): string {
  if (value instanceof Error) {
    return truncateText(`${value.name}: ${value.message}`);
  }
  if (typeof value === 'string') return truncateText(value);
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) {
    return truncateText(`[array(${value.length})] ${JSON.stringify(value.slice(0, 4))}`);
  }
  try {
    return truncateText(JSON.stringify(value));
  } catch {
    return truncateText(String(value));
  }
}

function parsePrefix(value: string): {
  moduleId: string;
  component: string | null;
  message: string;
  prefix: string | null;
} {
  const match = value.match(/^\[([^\]]+)\](?:\s*\[([^\]]+)\])?\s*(.*)$/);
  if (!match) {
    return {
      moduleId: 'console',
      component: null,
      message: value,
      prefix: null,
    };
  }

  const token1 = match[1]?.trim() ?? '';
  const token2 = match[2]?.trim() ?? '';
  const message = match[3]?.trim() || value.trim();
  return {
    moduleId: normalizeModuleToken(token1) ?? 'console',
    component: token2 || token1 || null,
    message,
    prefix: token1 || null,
  };
}

function resolveConsoleLevel(method: ConsoleMethodName): TelemetryLevel {
  switch (method) {
    case 'error':
      return 'error';
    case 'warn':
      return 'warn';
    case 'info':
      return 'info';
    case 'debug':
    case 'log':
    default:
      return 'debug';
  }
}

function normalizeConsoleEntry(method: ConsoleMethodName, args: unknown[]): ConsoleTelemetryEntry | null {
  if (args.length === 0) return null;

  const previews = args.slice(0, CONSOLE_ARGS_PREVIEW_LIMIT).map(previewValue);
  const primaryPreview = previews[0] ?? '';
  const primaryText =
    typeof args[0] === 'string'
      ? args[0]
      : args[0] instanceof Error
        ? `${args[0].name}: ${args[0].message}`
        : primaryPreview;

  const parsed = parsePrefix(primaryText);
  const trailingPreview = previews.slice(1);
  const messageParts = [parsed.message, ...trailingPreview].filter(
    (part): part is string => typeof part === 'string' && part.trim().length > 0
  );

  return {
    moduleId: parsed.moduleId,
    component: parsed.component,
    event: `console.${method}`,
    level: resolveConsoleLevel(method),
    message: messageParts.length > 0 ? messageParts.join(' | ') : null,
    fields: {
      consoleMethod: method,
      argCount: args.length,
      prefix: parsed.prefix,
      argsPreview: previews,
    },
  };
}

function enqueuePendingEntry(entry: ConsoleTelemetryEntry): void {
  pendingEntries.push(entry);
  const overflow = pendingEntries.length - CONSOLE_BRIDGE_QUEUE_LIMIT;
  if (overflow > 0) {
    pendingEntries.splice(0, overflow);
  }
}

function forwardEntry(entry: ConsoleTelemetryEntry): void {
  if (!attachedService) {
    enqueuePendingEntry(entry);
    return;
  }
  attachedService.ingest(entry.moduleId, entry, entry.component);
}

function flushPendingEntries(): void {
  if (!attachedService || pendingEntries.length === 0) return;
  const batch = pendingEntries.slice();
  pendingEntries = [];
  for (const entry of batch) {
    attachedService.ingest(entry.moduleId, entry, entry.component);
  }
}

export function installConsoleBridge(): void {
  if (bridgeInstalled || typeof console === 'undefined') return;
  bridgeInstalled = true;

  for (const method of CONSOLE_METHODS) {
    originalConsole[method] = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      originalConsole[method]?.(...args);

      if (bridgeForwardingDepth > 0) {
        return;
      }

      const entry = normalizeConsoleEntry(method, args);
      if (!entry) return;

      bridgeForwardingDepth += 1;
      try {
        forwardEntry(entry);
      } finally {
        bridgeForwardingDepth -= 1;
      }
    };
  }
}

export function attachConsoleBridge(service: TelemetryService): () => void {
  installConsoleBridge();
  attachedService = service;
  flushPendingEntries();
  return () => {
    if (attachedService === service) {
      attachedService = null;
    }
  };
}

export function restoreConsoleBridgeForTests(): void {
  if (!bridgeInstalled || typeof console === 'undefined') {
    pendingEntries = [];
    attachedService = null;
    bridgeForwardingDepth = 0;
    return;
  }

  for (const method of CONSOLE_METHODS) {
    const original = originalConsole[method];
    if (original) {
      console[method] = original;
    }
  }

  bridgeInstalled = false;
  bridgeForwardingDepth = 0;
  attachedService = null;
  pendingEntries = [];
}
