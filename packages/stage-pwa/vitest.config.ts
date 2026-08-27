import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.ts'

// Separate from vite.config.ts (which stays dev/build-only) so `vite`/`vite build` never
// pick up test-only settings by accident; `mergeConfig` keeps the @vitejs/plugin-react
// setup instead of duplicating it here.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'happy-dom',
      setupFiles: ['./src/test/setup.ts'],
    },
  }),
)
