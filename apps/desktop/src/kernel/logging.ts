export type KernelLogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export type KernelLogFields = Record<string, unknown>;

export type KernelLogOptions = {
  message?: string;
  fields?: KernelLogFields;
};

export type KernelLogSink = {
  log: (
    component: string,
    level: KernelLogLevel,
    event: string,
    options?: KernelLogOptions
  ) => void;
};

export type KernelLogger = {
  trace: (event: string, options?: KernelLogOptions) => void;
  debug: (event: string, options?: KernelLogOptions) => void;
  info: (event: string, options?: KernelLogOptions) => void;
  warn: (event: string, options?: KernelLogOptions) => void;
  error: (event: string, options?: KernelLogOptions) => void;
  fatal: (event: string, options?: KernelLogOptions) => void;
};

let activeKernelLogSink: KernelLogSink | null = null;

function emitKernelLog(
  component: string,
  level: KernelLogLevel,
  event: string,
  options?: KernelLogOptions
): void {
  activeKernelLogSink?.log(component, level, event, options);
}

export function setKernelLogSink(sink: KernelLogSink | null): void {
  activeKernelLogSink = sink;
}

export function getKernelLogger(component: string): KernelLogger {
  return {
    trace: (event, options) => emitKernelLog(component, 'trace', event, options),
    debug: (event, options) => emitKernelLog(component, 'debug', event, options),
    info: (event, options) => emitKernelLog(component, 'info', event, options),
    warn: (event, options) => emitKernelLog(component, 'warn', event, options),
    error: (event, options) => emitKernelLog(component, 'error', event, options),
    fatal: (event, options) => emitKernelLog(component, 'fatal', event, options),
  };
}
