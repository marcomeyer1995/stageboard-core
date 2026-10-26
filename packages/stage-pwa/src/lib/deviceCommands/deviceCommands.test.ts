import { describe, expect, it, vi } from 'vitest'

// The translators (imported only for their capability strings) construct a PouchDB on import.
vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    changes() {
      return { on: () => undefined, cancel: () => {} }
    }
  },
}))

const { commandsFor, describeCue, fieldAnswered, fieldOptions, payloadFromAnswers } = await import('./index')
const { CQ18T_CAPABILITY } = await import('../cq18tTranslator')
const { UI24R_CAPABILITY } = await import('../ui24rTranslator')
const { KEMPER_CAPABILITY, MG30_CAPABILITY, RC500_CAPABILITY } = await import('../midiDeviceProtocols')

describe('commandsFor', () => {
  it('knows every device type that has a translator', () => {
    for (const capability of [KEMPER_CAPABILITY, RC500_CAPABILITY, MG30_CAPABILITY, CQ18T_CAPABILITY, UI24R_CAPABILITY, 'click-track']) {
      expect(commandsFor(capability).length).toBeGreaterThan(0)
    }
    expect(commandsFor('lighting')).toEqual([])
  })
})

describe('describeCue', () => {
  it('reads a cue in words, falling back to its raw type', () => {
    expect(describeCue({ type: 'kemper.selectRig', payload: { performance: 11, slot: 3 } }, KEMPER_CAPABILITY)).toBe('Performance 12, Slot 3')
    expect(describeCue({ type: 'mg30.setKnob', payload: { cc: 24, value: 70 } }, MG30_CAPABILITY)).toBe('Amp – Regler 3 = 70')
    expect(describeCue({ type: 'mg30.selectPatch', payload: { program: 5 } }, MG30_CAPABILITY)).toBe('Patch 02B')
    expect(describeCue({ type: 'cq18t.setMute', payload: { channel: 'main', muted: true } }, CQ18T_CAPABILITY)).toBe('Main stumm')
    expect(describeCue({ type: 'custom.thing' }, 'lighting')).toBe('custom.thing')
  })
})

describe('payloadFromAnswers', () => {
  const rig = commandsFor(KEMPER_CAPABILITY).find((c) => c.type === 'kemper.selectRig')!
  const mute = commandsFor(CQ18T_CAPABILITY).find((c) => c.type === 'cq18t.setMute')!
  const level = commandsFor(CQ18T_CAPABILITY).find((c) => c.type === 'cq18t.setLevel')!

  it('turns the answers into the payload the translator expects', () => {
    expect(payloadFromAnswers(rig.fields, { performance: '11', slot: '3' })).toEqual({ payload: { performance: 11, slot: 3 } })
    expect(payloadFromAnswers(mute.fields, { channel: 'main', muted: 'true' })).toEqual({ payload: { channel: 'main', muted: true } })
    expect(payloadFromAnswers(mute.fields, { channel: '4', muted: 'false' })).toEqual({ payload: { channel: 4, muted: false } })
    expect(payloadFromAnswers(level.fields, { channel: '2', db: '-6,5' })).toEqual({ payload: { channel: 2, db: -6.5 } })
  })

  it('names the field that does not fit', () => {
    expect(payloadFromAnswers(rig.fields, { performance: '11', slot: '7' })).toEqual({ error: 'Slot: ganze Zahl von 1 bis 5.' })
    expect(payloadFromAnswers(rig.fields, { performance: '200', slot: '1' })).toEqual({ error: 'Performance: bitte auswählen.' })
    expect(payloadFromAnswers(level.fields, { channel: '2', db: 'laut' })).toEqual({ error: 'Pegel: eine Zahl in dB.' })
  })
})

describe('MG-30 in the musician\'s terms', () => {
  const [patch, knob] = commandsFor(MG30_CAPABILITY)
  it('lists the patches by their names 01A-32D', () => {
    const options = (patch!.fields[0] as { options: { value: number; label: string }[] }).options
    expect(options.length).toBe(128)
    expect([options[0], options[1], options[4], options[127]]).toEqual([{ value: 0, label: '01A' }, { value: 1, label: '01B' }, { value: 4, label: '02A' }, { value: 127, label: '32D' }])
  })
  it('names every knob by block and position, compressor knob 4 on CC 90 included, CC 16 not', () => {
    const options = (knob!.fields[0] as { options: { value: number; label: string }[] }).options
    expect(options.find((o) => o.value === 90)?.label).toBe('Kompressor – Regler 4')
    expect(options.find((o) => o.value === 22)?.label).toBe('Amp – Regler 1')
    expect(options.find((o) => o.value === 56)?.label).toBe('Delay – Regler 5')
    expect(options.some((o) => o.value === 16)).toBe(false)
  })
})

describe('Kemper: switch off too (Marco, 2026-10-18)', () => {
  it('describes stomp on/off and the tuner', async () => {
    const { describeCue } = await import('./index')
    expect(describeCue({ type: 'kemper.stomp', payload: { stomp: 'DELAY' } }, 'kemper-control')).toBe('Stomp DELAY an')
    expect(describeCue({ type: 'kemper.stomp', payload: { stomp: 'DELAY', off: true } }, 'kemper-control')).toBe('Stomp DELAY aus')
    expect(describeCue({ type: 'kemper.tuner', payload: { off: true } }, 'kemper-control')).toBe('Tuner aus')
  })
})

describe('OSC commands (#484)', () => {
  const [send] = commandsFor('osc')

  it('take an address and optional values as text', () => {
    expect(send!.type).toBe('osc.send')
    expect(payloadFromAnswers(send!.fields, { address: '/cue/12/go', args: ' 1 0.5 "Intro" ' })).toEqual({ payload: { address: '/cue/12/go', args: '1 0.5 "Intro"' } })
    expect(payloadFromAnswers(send!.fields, { address: '/scene/3' })).toEqual({ payload: { address: '/scene/3' } })
    expect(payloadFromAnswers(send!.fields, { address: 'cue 12' })).toEqual({ error: 'Adresse: beginnt mit „/“, ohne Leerzeichen.' })
    expect(payloadFromAnswers(send!.fields, { address: '' })).toEqual({ error: 'Adresse: bitte ausfüllen.' })
  })

  it('a text field is answered when filled - or when it may stay empty', () => {
    expect(fieldAnswered(send!.fields[0]!, '')).toBe(false)
    expect(fieldAnswered(send!.fields[1]!, '')).toBe(true)
    expect(fieldOptions(send!.fields[0]!)).toEqual([])
  })

  it('reads as address and values on the cue marker', () => {
    expect(describeCue({ type: 'osc.send', payload: { address: '/cue/12/go', args: '1' } }, 'osc')).toBe('/cue/12/go 1')
    expect(describeCue({ type: 'osc.send', payload: { address: '/blackout' } }, 'osc')).toBe('/blackout')
  })
})
