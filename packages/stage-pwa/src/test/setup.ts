import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// Testing Library doesn't auto-register its cleanup without `test.globals: true` (which
// this project deliberately doesn't use - every other test file imports describe/it/expect
// explicitly), so it's wired up here instead: unmounts every rendered component after each
// test so component tests can't leak DOM state into one another.
afterEach(() => {
  cleanup()
})
