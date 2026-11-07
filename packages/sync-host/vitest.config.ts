import { defineConfig } from 'vitest/config'

// The sources only - `npm run build` puts compiled copies of the tests into dist/.
export default defineConfig({ test: { include: ['src/**/*.test.ts'] } })
