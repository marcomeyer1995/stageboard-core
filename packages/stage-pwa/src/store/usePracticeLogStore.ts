import { create } from 'zustand'
import type { PracticeLogEntry } from 'shared-types'
import type { LocalChangesHandle } from '../lib/localChanges'
import { getAllPracticeLog, practiceLogChanges, putPracticeLogEntry, switchPracticeLogWorkspace } from '../lib/practiceLogDb'

interface PracticeLogState {
  entries: PracticeLogEntry[]
  init: (workspaceId: string) => Promise<void>
  add: (entry: PracticeLogEntry) => Promise<void>
}

let changesHandle: LocalChangesHandle<PracticeLogEntry> | null = null

async function refresh(set: (partial: Partial<PracticeLogState>) => void) {
  set({ entries: await getAllPracticeLog() })
}

/** Solo-Üben takes of the whole band (lib/practiceQueue.ts writes them; the Bibliothek reads the own ones). */
export const usePracticeLogStore = create<PracticeLogState>((set) => ({
  entries: [],
  init: async (workspaceId) => {
    changesHandle?.cancel()
    changesHandle = null
    switchPracticeLogWorkspace(workspaceId)
    set({ entries: [] })
    await refresh(set)
    changesHandle = practiceLogChanges()
    changesHandle.on('change', () => refresh(set))
  },
  add: async (entry) => {
    await putPracticeLogEntry(entry)
  },
}))
