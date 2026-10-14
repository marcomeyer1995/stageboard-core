import { describe, expect, it } from 'vitest'
import { clickTimeline } from './beatGrid'
import { announcementsDue, partNames, sectionAnnouncements, spokenTexts } from './announcements'

// 120 BPM 4/4: a bar is 2000 ms, bar 1 at 0.
const timeline = clickTimeline({ bpm: 120, timeSignature: '4/4' })
const song = [
  '{start_of_verse: Strophe 1}',
  '[00:00.00]Erste Zeile',
  '[00:04.00]Zweite Zeile',
  '{end_of_verse}',
  '{start_of_chorus}',
  '[00:07.90]Refrain singt',
  '{end_of_chorus}',
  '{part: Bridge}',
  '[00:16.10]Brücke',
].join('\n')

describe('section announcements (#63)', () => {
  it('speaks each named part a bar ahead, on the downbeat - part starts rounded to the nearest bar', () => {
    const items = sectionAnnouncements(song, timeline)
    // Strophe 1 on bar 1 has no bar before it without a count-in.
    expect(items).toEqual([
      { text: 'Chorus', atMs: 6000, bar: 5, kind: 'name' }, // sung at 7.9 s -> bar 5 (8.0 s), voice on bar 4 (6.0 s)
      { text: 'Bridge', atMs: 14000, bar: 9, kind: 'name' }, // 16.1 s -> bar 9 (16.0 s), voice on bar 8 (14.0 s)
    ])
  })

  it('announces a part on bar 1 in the count-in bar', () => {
    const items = sectionAnnouncements(song, clickTimeline({ bpm: 120, timeSignature: '4/4', countInBars: 1 }))
    expect(items[0]).toEqual({ text: 'Strophe 1', atMs: -2000, bar: 1, kind: 'name' })
  })

  it('leaves out parts without a name or without a timed line', () => {
    expect(sectionAnnouncements('{start_of_chorus}\nkeine Zeit\n{end_of_chorus}\n[00:02.00]ohne Part', timeline)).toEqual([])
  })
})

describe('announcementsDue', () => {
  const items = [
    { text: 'A', atMs: 1000, bar: 2, kind: 'name' as const },
    { text: 'B', atMs: 5000, bar: 4, kind: 'name' as const },
  ]
  it('hands each announcement over once, inside the look-ahead', () => {
    const done = new Set<number>()
    expect(announcementsDue(items, 800, 300, done)).toEqual([{ index: 0, inMs: 200 }])
    expect(announcementsDue(items, 900, 300, done)).toEqual([])
  })
  it('drops one that is already too late (joined mid-song)', () => {
    const done = new Set<number>()
    expect(announcementsDue(items, 1200, 300, done)).toEqual([])
    expect(done.has(0)).toBe(true)
    expect(announcementsDue(items, 1100, 300, new Set())).toEqual([{ index: 0, inMs: -100 }])
  })
})

describe("the band's spoken texts", () => {
  it("says the band's own text, skips muted parts, else the name as written", () => {
    const items = sectionAnnouncements(song, timeline, { texts: { chorus: 'Refrää', Bridge: null } })
    expect(items.map((a) => a.text)).toEqual(['Refrää'])
    const say = spokenTexts({ Chorus: '  ', 'Verse 2': 'Zwodde Strophe' })
    expect([say('Chorus'), say('verse 2'), say('Outro'), say(null)]).toEqual(['Chorus', 'Zwodde Strophe', 'Outro', null])
  })

  it('collects every part name once, as first written', () => {
    expect(partNames(['{start_of_chorus}\n{part: Bridge}', '{part: bridge}\n{start_of_verse: Strophe 1}'])).toEqual(['Bridge', 'Chorus', 'Strophe 1'])
  })
})

describe('countdown and count-in (Marco 2026-10-14: "Chorus in 3, 2, 1, Go", all configurable)', () => {
  const said = (items: { text: string; atMs: number }[]) => items.map((a) => `${a.text}@${a.atMs}`)
  // Chorus on bar 5 (8.0 s), a bar = 2000 ms, a beat = 500 ms.
  const chorusOnly = '{start_of_chorus}\n[00:08.00]Refrain'

  it('name two bars ahead, then 3-2-1 on the last beats and "Los" on the first beat', () => {
    const items = sectionAnnouncements(chorusOnly, timeline, { nameBarsBefore: 2, countdown: { enabled: true, beats: 3, words: ['eins', 'zwei', 'drei'], go: 'Los' } })
    expect(said(items)).toEqual(['Chorus@4000', 'drei@6500', 'zwei@7000', 'eins@7500', 'Los@8000'])
  })

  it('numbers without own words are digits; four beats start on the downbeat and push the name out', () => {
    const items = sectionAnnouncements(chorusOnly, timeline, { countdown: { enabled: true, beats: 4, words: [], go: null } })
    expect(said(items)).toEqual(['Chorus@6000', '3@6500', '2@7000', '1@7500'])
    // The name and "4" share the downbeat: the name wins, "4" is left out.
  })

  it('count-in "count": the count-in beats are spoken, the Intro on bar 1 is not announced', () => {
    const intro = '{part: Intro}\n[00:00.00]Los gehts\n' + chorusOnly
    const items = sectionAnnouncements(intro, clickTimeline({ bpm: 120, timeSignature: '4/4', countInBars: 1 }), { countIn: 'count' })
    expect(said(items)).toEqual(['1@-2000', '2@-1500', '3@-1000', '4@-500', 'Chorus@6000'])
  })

  it('count-in "click": nothing before bar 1; "announce": the Intro inside the count-in, nothing before the first click', () => {
    const intro = '{part: Intro}\n[00:00.00]Los gehts'
    const twoBars = clickTimeline({ bpm: 120, timeSignature: '4/4', countInBars: 1 })
    const countdown = { enabled: true, beats: 3, words: [], go: null }
    expect(sectionAnnouncements(intro, twoBars, { countIn: 'click', countdown })).toEqual([])
    // Name two bars ahead would be before the first click (one count-in bar): only the countdown remains.
    expect(said(sectionAnnouncements(intro, twoBars, { countIn: 'announce', nameBarsBefore: 2, countdown }))).toEqual(['3@-1500', '2@-1000', '1@-500'])
  })

  it('parts close together: the later part loses what overlaps the earlier one', () => {
    // Chorus on bar 5, Bridge on bar 6: Bridge's name (bar 4) would come before Chorus' countdown ends.
    const close = chorusOnly + '\n{part: Bridge}\n[00:10.00]Brücke'
    const items = sectionAnnouncements(close, timeline, { nameBarsBefore: 2, countdown: { enabled: true, beats: 3, words: [], go: null } })
    expect(said(items)).toEqual(['Chorus@4000', '3@6500', '2@7000', '1@7500', '3@8500', '2@9000', '1@9500'])
  })
})
