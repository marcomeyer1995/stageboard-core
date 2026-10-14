import { describe, expect, it } from 'vitest'
import { clickTimeline } from './beatGrid'
import { announcementsDue, sectionAnnouncements } from './announcements'

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

  it('announces a part on bar 1 in the count-in bar', () => {
    const items = sectionAnnouncements(song, clickTimeline({ bpm: 120, timeSignature: '4/4', countInBars: 1 }))
    expect(items[0]).toEqual({ text: 'Strophe 1', atMs: -2000, bar: 1 })
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
