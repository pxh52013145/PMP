import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react-swc';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: [],
    coverage: {
      reporter: ['text', 'html'],
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
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
});
