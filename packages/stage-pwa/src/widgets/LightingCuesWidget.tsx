import { CueGrid } from './CueGrid'

const CUES = ['Voll', 'Dimmen', 'Chase', 'Farbwechsel'] as const

export function LightingCuesWidget() {
  return <CueGrid actions={CUES} />
}
