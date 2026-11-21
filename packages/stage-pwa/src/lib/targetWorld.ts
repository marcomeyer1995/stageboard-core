import { create } from 'zustand'
import type { TargetWorld } from 'shared-types'
import { NO_WORLD } from './targetWorldOf'

/**
 * Who the hosts and the tablets are, for reading a binding's `executionTarget` (#964). A small store of its own on purpose: the routing code and its
 * tests read it without pulling in the roster's database. `useTargetWorldSync` (mounted once, `targetWorldSync.ts`) keeps it current.
 */
export const useTargetWorldStore = create<{ world: TargetWorld; set: (world: TargetWorld) => void }>((set) => ({ world: NO_WORLD, set: (world) => set({ world }) }))

/** The world as it is right now - for code that is not a component (the cue scheduler, actions). */
export const currentTargetWorld = (): TargetWorld => useTargetWorldStore.getState().world

/** The same for a component: it draws again when it changes. */
export const useTargetWorld = (): TargetWorld => useTargetWorldStore((s) => s.world)
