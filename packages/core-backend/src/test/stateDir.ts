import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach } from 'vitest'

// Every test file gets its own throwaway state directory (active band, deleted-band list, …),
// so no test ever writes into the checkout's ./data (#364: the DELETE tests used to record their
// fake band ids there). Re-applied before each test, because suites that set their own
// directory delete the variable again afterwards.
const defaultStateDir = mkdtempSync(join(tmpdir(), 'stageboard-state-test-'))

beforeEach(() => {
  if (!process.env.STAGEBOARD_STATE_DIR) process.env.STAGEBOARD_STATE_DIR = defaultStateDir
})
