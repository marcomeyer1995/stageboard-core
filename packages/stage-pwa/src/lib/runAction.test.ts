import { beforeEach, describe, expect, it, vi } from 'vitest'

const jumps = vi.hoisted(() => ({ queueSectionJump: vi.fn(async () => 'queued'), cancelSectionJump: vi.fn(), setSectionLoop: vi.fn() }))
vi.mock('./sectionJump', () => jumps)
vi.mock('./deviceAction', () => ({ fireDeviceAction: vi.fn(async () => null) }))
vi.mock('../store/useShowStateStore', () => ({ useShowStateStore: { getState: () => ({ state: { playbackLoop: null }, startReadyCheck: vi.fn() }) } }))

const { runAction } = await import('./runAction')

// 120 bpm 4/4: a bar every 2 s. Intro 0, Chorus 8 s, Verse 16 s, Chorus 24 s.
const content = ['{part: Intro}', '[00:00.00]x', '{part: Chorus}', '[00:08.00]a', '{part: Verse}', '[00:16.00]b', '{part: Chorus}', '[00:24.00]c'].join('\n')
const show = {
  canControl: true,
  elapsedMs: 17_000 as number | null,
  playbackStatus: 'playing',
  trackEnded: false,
  liveTempoAdjustPercent: 0,
  trackOverride: null,
  queue: { currentEntry: { id: 'e1', songId: 's1' }, currentSong: { bpm: 120, timeSignature: '4/4', chordProContent: content }, currentVariant: null },
}

beforeEach(() => vi.clearAllMocks())

describe('runAction - sections (#479 via docs/23)', () => {
  it('jumps by name to the next section of that name after where the song stands', async () => {
    expect(await runAction({ kind: 'section', op: 'jump', label: 'chorus', when: 'bar' }, show as never)).toBeNull()
    expect(jumps.queueSectionJump).toHaveBeenCalledWith(expect.objectContaining({ label: 'Chorus', startMs: 24_000 }), 'bar', expect.any(Array), expect.anything())
  })

  it('"Nächster Abschnitt" from the verse is the second chorus', async () => {
    await runAction({ kind: 'section', op: 'next', when: 'section' }, show as never)
    expect(jumps.queueSectionJump).toHaveBeenCalledWith(expect.objectContaining({ startMs: 24_000 }), 'section', expect.any(Array), expect.anything())
  })

  it('says why when the song has no such section, and only the master may', async () => {
    expect(await runAction({ kind: 'section', op: 'jump', label: 'Bridge' }, show as never)).toMatch(/Bridge/)
    expect(await runAction({ kind: 'section', op: 'next' }, { ...show, canControl: false } as never)).toBe('Nur der Master steuert die Show')
    expect(jumps.queueSectionJump).not.toHaveBeenCalled()
  })
})
