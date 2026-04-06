import type { HostAudioService, HostNavigation } from '../pluginHostApi';

export const RUNTIME_EVENT_NAMES = {
  permissionDenied: 'permission.denied',
  commandResult: 'command.result',
  configChanged: 'config.changed',
  audioState: 'audio.state',
  audioTime: 'audio.time',
  audioEnded: 'audio.ended',
  audioLoadProgress: 'audio.load-progress',
  audioError: 'audio.error',
  navigationChanged: 'navigation.changed',
  visualizerSpectrum: 'visualizer.spectrum',
  visualizerFramePre: 'visualizer.frame.pre',
  visualizerFramePost: 'visualizer.frame.post',
} as const;

export type RuntimeEventName = (typeof RUNTIME_EVENT_NAMES)[keyof typeof RUNTIME_EVENT_NAMES];

const RUNTIME_EVENT_TO_PMPM_COMPAT_EVENT: Record<string, string> = {
  [RUNTIME_EVENT_NAMES.configChanged]: 'config.changed',
  [RUNTIME_EVENT_NAMES.audioState]: 'audio.state',
  [RUNTIME_EVENT_NAMES.audioTime]: 'audio.time',
  [RUNTIME_EVENT_NAMES.audioEnded]: 'audio.ended',
  [RUNTIME_EVENT_NAMES.audioLoadProgress]: 'audio.loadProgress',
  [RUNTIME_EVENT_NAMES.audioError]: 'audio.error',
  [RUNTIME_EVENT_NAMES.navigationChanged]: 'navigation.changed',
  [RUNTIME_EVENT_NAMES.visualizerSpectrum]: 'audio.spectrum',
  [RUNTIME_EVENT_NAMES.visualizerFramePre]: 'audio.spectrumFrame.pre',
  [RUNTIME_EVENT_NAMES.visualizerFramePost]: 'audio.spectrumFrame.post',
};

export function mapRuntimeEventNameToPmpmCompatEvent(eventName: string): string | null {
  return RUNTIME_EVENT_TO_PMPM_COMPAT_EVENT[eventName] ?? null;
}

export interface BindHostRuntimeEventChannelOptions {
  permissions: ReadonlySet<string>;
  audioService: HostAudioService;
  navigation: HostNavigation;
  emitRuntimeEvent: (eventName: RuntimeEventName, payload?: unknown) => void | Promise<void>;
  subscribeConfig?: (listener: (config: Record<string, unknown>) => void) => () => void;
  getSpectrum?: () => unknown;
  getSpectrumFrame?: (options?: { tap?: 'pre-dsp' | 'post-dsp' }) => unknown;
  visualizerIntervalMs?: number;
  setIntervalFn?: (
    handler: () => void,
    timeoutMs: number
  ) => ReturnType<typeof setInterval>;
  clearIntervalFn?: (handle: ReturnType<typeof setInterval>) => void;
}

function emitBestEffort(
  emitRuntimeEvent: BindHostRuntimeEventChannelOptions['emitRuntimeEvent'],
  eventName: RuntimeEventName,
  payload?: unknown
): void {
  void Promise.resolve(emitRuntimeEvent(eventName, payload)).catch(() => undefined);
}

export function bindHostRuntimeEventChannel(
  options: BindHostRuntimeEventChannelOptions
): () => void {
  const disposers: Array<() => void> = [];
  const setIntervalFn = options.setIntervalFn ?? ((handler, timeoutMs) => setInterval(handler, timeoutMs));
  const clearIntervalFn = options.clearIntervalFn ?? ((handle) => clearInterval(handle));

  if (options.permissions.has('api:audio-state')) {
    disposers.push(
      options.audioService.onStateChange((state) => {
        emitBestEffort(options.emitRuntimeEvent, RUNTIME_EVENT_NAMES.audioState, { state });
      })
    );
    disposers.push(
      options.audioService.onTimeUpdate((time) => {
        emitBestEffort(options.emitRuntimeEvent, RUNTIME_EVENT_NAMES.audioTime, { time });
      })
    );
    disposers.push(
      options.audioService.onEnded(() => {
        emitBestEffort(options.emitRuntimeEvent, RUNTIME_EVENT_NAMES.audioEnded);
      })
    );

    if (typeof options.audioService.onLoadProgress === 'function') {
      disposers.push(
        options.audioService.onLoadProgress((progress) => {
          emitBestEffort(options.emitRuntimeEvent, RUNTIME_EVENT_NAMES.audioLoadProgress, {
            progress,
          });
        })
      );
    }

    if (typeof options.audioService.onError === 'function') {
      disposers.push(
        options.audioService.onError((error) => {
          emitBestEffort(options.emitRuntimeEvent, RUNTIME_EVENT_NAMES.audioError, {
            message: error instanceof Error ? error.message : String(error ?? ''),
          });
        })
      );
    }
  }

  if (options.permissions.has('api:navigation') && typeof options.navigation.subscribe === 'function') {
    disposers.push(
      options.navigation.subscribe((snapshot) => {
        emitBestEffort(options.emitRuntimeEvent, RUNTIME_EVENT_NAMES.navigationChanged, {
          snapshot,
        });
      })
    );
  }

  if (options.permissions.has('storage:local') && typeof options.subscribeConfig === 'function') {
    disposers.push(
      options.subscribeConfig((config) => {
        emitBestEffort(options.emitRuntimeEvent, RUNTIME_EVENT_NAMES.configChanged, { config });
      })
    );
  }

  let visualizerInterval: ReturnType<typeof setInterval> | null = null;
  if (options.permissions.has('api:audio-visual')) {
    visualizerInterval = setIntervalFn(() => {
      emitBestEffort(options.emitRuntimeEvent, RUNTIME_EVENT_NAMES.visualizerSpectrum, {
        spectrum: typeof options.getSpectrum === 'function' ? options.getSpectrum() : null,
      });
      emitBestEffort(options.emitRuntimeEvent, RUNTIME_EVENT_NAMES.visualizerFramePre, {
        frame:
          typeof options.getSpectrumFrame === 'function'
            ? options.getSpectrumFrame({ tap: 'pre-dsp' })
            : null,
      });
      emitBestEffort(options.emitRuntimeEvent, RUNTIME_EVENT_NAMES.visualizerFramePost, {
        frame:
          typeof options.getSpectrumFrame === 'function'
            ? options.getSpectrumFrame({ tap: 'post-dsp' })
            : null,
      });
    }, Math.max(16, Math.floor(options.visualizerIntervalMs ?? 33)));
  }

  return () => {
    if (visualizerInterval !== null) {
      clearIntervalFn(visualizerInterval);
    }
    for (const dispose of disposers) {
      try {
        dispose();
      } catch {
        // ignore
      }
    }
  };
}
