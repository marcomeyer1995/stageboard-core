import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { clearLastKnownHost } from '../lib/hostUrlStatusCache'
import '@testing-library/jest-dom/vitest'
import i18n from '../i18n'

// Testing Library doesn't auto-register its cleanup without `test.globals: true` (which
// this project deliberately doesn't use - every other test file imports describe/it/expect
// explicitly), so it's wired up here instead: unmounts every rendered component after each
// test so component tests can't leak DOM state into one another.
afterEach(() => {
  cleanup()
  // The last-known Host status is shared module state (useHostUrlStatus.ts) - without
  // this, one test's "reachable" server would be shown instantly in the next test's render.
  clearLastKnownHost()
})

// The app's texts (#456): German in every test, whatever language the test environment reports.
void i18n.changeLanguage('de')
