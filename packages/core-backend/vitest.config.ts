import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Only the sources: `npm run build` emits the compiled tests into dist/ as well,
    // and without this vitest would run every suite twice.
    include: ['src/**/*.test.ts'],
  },
})
