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
      { text: 'Chorus', atMs: 6000, bar: 5 }, // sung at 7.9 s -> bar 5 (8.0 s), voice on bar 4 (6.0 s)
      { text: 'Bridge', atMs: 14000, bar: 9 }, // 16.1 s -> bar 9 (16.0 s), voice on bar 8 (14.0 s)
    ])
  })

  it('the count-in pattern before bar 1: by default "1 – 2 – | 1 2 3 4", the last bar only with one count-in bar', () => {
    const one = sectionAnnouncements(song, clickTimeline({ bpm: 120, timeSignature: '4/4', countInBars: 1 }))
    expect(one.slice(0, 4).map((a) => `${a.text}@${a.atMs}`)).toEqual(['1@-2000', '2@-1500', '3@-1000', '4@-500'])
    const two = sectionAnnouncements(song, clickTimeline({ bpm: 120, timeSignature: '4/4', countInBars: 2 }))
    expect(two.slice(0, 6).map((a) => `${a.text}@${a.atMs}`)).toEqual(['1@-4000', '2@-3000', '1@-2000', '2@-1500', '3@-1000', '4@-500'])
  })

  it('leaves out parts without a name or without a timed line', () => {
    expect(sectionAnnouncements('{start_of_chorus}\nkeine Zeit\n{end_of_chorus}\n[00:02.00]ohne Part', timeline)).toEqual([])
  })
})

describe('announcementsDue', () => {
  const items = [
    { text: 'A', atMs: 1000, bar: 2 },
    { text: 'B', atMs: 5000, bar: 4 },
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

describe('cue patterns (Marco 2026-10-14: "lean but powerful" - one pattern instead of many switches)', () => {
  const said = (items: { text: string; atMs: number }[]) => items.map((a) => `${a.text}@${a.atMs}`)
  // Chorus on bar 5 (8.0 s), a bar = 2000 ms, a beat = 500 ms.
  const chorusOnly = '{start_of_chorus}\n[00:08.00]Refrain'

  it('"Name, 2, 3, 4": name and beat numbers in the bar before', () => {
    expect(said(sectionAnnouncements(chorusOnly, timeline, { partCue: [['{name}', '#', '#', '#']] }))).toEqual(['Chorus@6000', '2@6500', '3@7000', '4@7500'])
  })

  it("two bars, free words and the band's number words", () => {
    const partCue = [
      ['{name}', '', '3', ''],
      ['2', '', '#', 'Los'],
    ]
    expect(said(sectionAnnouncements(chorusOnly, timeline, { partCue, numberWords: ['', '', 'dra'] }))).toEqual(['Chorus@4000', '3@5000', '2@6000', 'dra@7000', 'Los@7500'])
  })

  it('cells follow the real bar: 3/4 uses the first three, 6/8 leaves the rest silent', () => {
    const partCue = [['{name}', '#', '#', '#']]
    // 120 BPM 3/4: a bar is 1500 ms, bar 5 at 6.0 s.
    expect(said(sectionAnnouncements('{start_of_chorus}\n[00:06.00]x', clickTimeline({ bpm: 120, timeSignature: '3/4' }), { partCue }))).toEqual([
      'Chorus@4500',
      '2@5000',
      '3@5500',
    ])
    // 6/8: a bar is 3000 ms, bar 3 at 6.0 s.
    expect(said(sectionAnnouncements('{start_of_chorus}\n[00:06.00]x', clickTimeline({ bpm: 120, timeSignature: '6/8' }), { partCue }))).toEqual([
      'Chorus@3000',
      '2@3500',
      '3@4000',
      '4@4500',
    ])
  })

  it('parts close together: nothing before the previous part starts - the earlier one finishes', () => {
    // Chorus on bar 5, Bridge on bar 6, two-bar pattern: Bridge's first bar is Chorus' bar before.
    const close = chorusOnly + '\n{part: Bridge}\n[00:10.00]Brücke'
    const partCue = [
      ['{name}', '', '', ''],
      ['', '', '#', '#'],
    ]
    expect(said(sectionAnnouncements(close, timeline, { partCue }))).toEqual(['Chorus@4000', '3@7000', '4@7500', '3@9000', '4@9500'])
  })

  it('count-in: the Intro by name, nothing before the first click; a muted part says nothing', () => {
    const intro = '{part: Intro}\n[00:00.00]Los gehts\n' + chorusOnly
    const oneBar = clickTimeline({ bpm: 120, timeSignature: '4/4', countInBars: 1 })
    expect(
      said(
        sectionAnnouncements(intro, oneBar, {
          countInCue: [
            ['{name}', '', '', ''],
            ['#', '', '', ''],
          ],
        }),
      ),
    ).toEqual(['1@-2000', 'Chorus@6000'])
    expect(said(sectionAnnouncements(intro, oneBar, { countInCue: [['{name}', '', '#', '#']], texts: { chorus: null } }))).toEqual(['Intro@-2000', '3@-1000', '4@-500'])
    // Without a count-in there is nowhere to say it.
    expect(said(sectionAnnouncements(intro, timeline))).toEqual(['Chorus@6000'])
  })

  it('old settings: the number words move over from countdown.words', () => {
    const old = { countdown: { enabled: true, words: ['oans', 'zwoa'] } } as never
    expect(said(sectionAnnouncements(chorusOnly, timeline, { ...(old as object), partCue: [['#', '#', '', '']] }))).toEqual(['oans@6000', 'zwoa@6500'])
  })
})
