import { CueGrid } from './CueGrid'

const ACTIONS = ['Strobo', 'Blackout', 'Kaltfunken', 'Talkback'] as const

export function QuickActionsWidget() {
  return <CueGrid actions={ACTIONS} />
}
