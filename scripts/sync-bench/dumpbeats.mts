// Writes beats.json (song time of every sounding beat of the reference song, #464) from the
// generator on the feat/reference-song branch:
//   git worktree add /tmp/refsong origin/feat/reference-song && node dumpbeats.mts /tmp/refsong
import { writeFileSync } from 'node:fs'
const root = process.argv[2] ?? '/tmp/refsong'
const { buildReferenceSong } = await import(`${root}/packages/stage-pwa/src/lib/referenceSong.ts`)
const s = buildReferenceSong()
writeFileSync(new URL('./beats.json', import.meta.url), JSON.stringify(s.beats.filter((b: { silent: boolean }) => !b.silent).map((b: { timeMs: number }) => b.timeMs)))
