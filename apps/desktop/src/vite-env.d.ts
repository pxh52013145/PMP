/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PERF_DISABLE_MATRIX_CANVAS?: string;
  readonly VITE_PERF_DISABLE_MAGNET_LAYER?: string;
  readonly VITE_PERF_DISABLE_BACKGROUND_LAYER?: string;
  readonly VITE_PERF_RUNTIME_PROFILE?: string;
  readonly VITE_PERF_NEXT_LOW_RENDER?: string;
  readonly VITE_PERF_PIXEL_ANTIALIAS?: string;
  readonly VITE_PERF_ROUND_PIXELS?: string;
  readonly VITE_PMP_STARTUP_MEMORY_TRACE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
