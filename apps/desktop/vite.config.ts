import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import { resolve } from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@pixel-matrix/plugin-platform-contracts': resolve(
        __dirname,
        '../../packages/plugin-platform-contracts/src/index.ts'
      ),
      '@pixel-matrix/plugin-compat-pmpm': resolve(
        __dirname,
        '../../packages/plugin-compat-pmpm/src/index.ts'
      ),
    },
  },

  // Tauri expects a fixed port will fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: [
        '**/src-tauri/target/**',
        '**/src-tauri/vendor/**',
        '**/src-tauri/sidecars/**',
        '**/src-tauri/binaries/**',
      ],
    },
  },

  // Env variables starting with VITE_ will be exposed to your frontend code
  envPrefix: ['VITE_', 'TAURI_'],

  build: {
    // Tauri uses Chromium on Windows and WebKit on macOS and Linux
    // Updated to safari14 for BigInt support (required by music-metadata)
    target: process.env.TAURI_PLATFORM == 'windows' ? 'chrome105' : 'safari14',
    // Don't minify for debug builds
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    // Produce sourcemaps for debug builds
    sourcemap: !!process.env.TAURI_DEBUG,
    // Multi-page build
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        editor: resolve(__dirname, 'editor.html'),
      },
    },
  },

  clearScreen: false,
});
