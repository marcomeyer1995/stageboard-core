import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { clearStageServerLog, setStageServerDebugEnabled } from '../lib/stageServerDebug'
import { clearLastKnownStageServer } from '../lib/stageServerStatusCache'
import '@testing-library/jest-dom/vitest'

// Testing Library doesn't auto-register its cleanup without `test.globals: true` (which
// this project deliberately doesn't use - every other test file imports describe/it/expect
// explicitly), so it's wired up here instead: unmounts every rendered component after each
// test so component tests can't leak DOM state into one another.
afterEach(() => {
  cleanup()
  // The last-known Stage-Server status is shared module state (useStageServerStatus.ts) - without
  // this, one test's "reachable" server would be shown instantly in the next test's render.
  clearLastKnownStageServer()
  // Same for the on-screen diagnostic log and its localStorage on/off flag.
  clearStageServerLog()
  setStageServerDebugEnabled(false)
})
