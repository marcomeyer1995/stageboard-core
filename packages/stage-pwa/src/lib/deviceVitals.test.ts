import { describe, expect, it } from 'vitest'
import { assessVitals, audioClockVitals, summarizeVitals, type VitalsSnapshot } from './deviceVitals'

/** 40 s of clock reads every 250 ms; `speed` = audio ms per real ms, `blockMs` = render block size. */
function clock(speed: number, blockMs = 0, lose: { atS: number; ms: number }[] = []) {
  const out: { perf: number; ctxMs: number }[] = []
  let lost = 0
  for (let perf = 0; perf <= 40_000; perf += 250) {
    for (const l of lose) if (perf === l.atS * 1000) lost += l.ms
    const raw = perf * speed - lost
    out.push({ perf, ctxMs: blockMs > 0 ? Math.floor(raw / blockMs) * blockMs : raw })
  }
  return out
}

const CLEAN: Pick<VitalsSnapshot, 'audio' | 'audioClock' | 'native' | 'stallsPerMin' | 'clock'> = {
  audio: { path: 'native', delayMs: 300, missingMs: 0, jumps: 0, leadMinMs: 200 },
  audioClock: { pct: -0.17, losses: 0, worstLossMs: 0 },
  native: { availMb: 3000, totalMb: 8000, thresholdMb: 200, lowMemory: false, appMb: 200, cpuMs: 0, uptimeMs: 0, cores: 8, cpuPct: 5 },
  stallsPerMin: 0,
  clock: { offsetMs: 30, uncertaintyMs: 1, rttMs: 12, ageMs: 1000 },
}

describe('audioClockVitals', () => {
  it('measures how much slower the audio clock runs (Redmi 0.17 %, the phone after 17 h 0.6 %)', () => {
    expect(audioClockVitals(clock(0.9983), 40_000)?.pct).toBeCloseTo(-0.17, 1)
    expect(audioClockVitals(clock(0.994), 40_000)?.pct).toBeCloseTo(-0.6, 1)
  })

  it('block rendering (the Fire, 160 ms) is not a loss', () => {
    const v = audioClockVitals(clock(1, 160), 40_000)
    expect(v?.losses).toBe(0)
    expect(Math.abs(v?.pct ?? 1)).toBeLessThan(0.05)
  })

  it('counts each stall the audio thread never caught up on', () => {
    const v = audioClockVitals(clock(1, 0, [{ atS: 12, ms: 120 }, { atS: 25, ms: 90 }]), 40_000)
    expect(v?.losses).toBe(2)
    expect(v?.worstLossMs).toBe(120)
  })
})

describe('assessVitals', () => {
  it('a healthy device is green', () => {
    expect(assessVitals(CLEAN)).toEqual({ level: 'ok', issues: [] })
  })

  it('the phone after 17 h: yellow for missing audio, the clock and the memory - red only once it switched over', () => {
    const phone = {
      ...CLEAN,
      audio: { path: 'native' as const, delayMs: 332, missingMs: 13967, jumps: 2, leadMinMs: 3 },
      audioClock: { pct: -0.6, losses: 4, worstLossMs: 128 },
      native: { ...CLEAN.native!, availMb: 250, totalMb: 11190 },
    }
    expect(assessVitals(phone)).toEqual({ level: 'warning', issues: ['audioMissing', 'audioClock', 'audioTight', 'memoryTight'] })
  })

  it('after switching to the WebView output it stays red until the app restarts', () => {
    const fell = { ...CLEAN, audio: { path: 'webview' as const, delayMs: null, missingMs: 0, jumps: 0, leadMinMs: null, fellBack: true } }
    expect(assessVitals(fell).issues).toEqual(['audioFallback'])
    expect(assessVitals(fell).level).toBe('error')
  })

  it('Android saying memory is low is red; long frames and an unsure band clock are yellow', () => {
    expect(assessVitals({ ...CLEAN, native: { ...CLEAN.native!, lowMemory: true } }).level).toBe('error')
    expect(assessVitals({ ...CLEAN, stallsPerMin: 2 })).toEqual({ level: 'warning', issues: ['stalls'] })
    expect(assessVitals({ ...CLEAN, clock: { ...CLEAN.clock, ageMs: 60_000 } }).issues).toEqual(['clockUnsure'])
  })

  it('a browser without the app: no memory, no band clock yet - nothing to complain about', () => {
    expect(assessVitals({ ...CLEAN, audio: null, native: null, audioClock: null, clock: { offsetMs: 0, uncertaintyMs: null, rttMs: null, ageMs: null } }).level).toBe('ok')
  })
})

describe('summarizeVitals', () => {
  it('reports the light with the numbers that explain it', () => {
    const snapshot: VitalsSnapshot = { ...CLEAN, at: 0, jsHeapMb: 80, jsHeapLimitMb: 1000, worstFrameMs: 40, framesWatched: true, uptimeMs: 63 * 60_000 }
    expect(summarizeVitals(snapshot)).toEqual({ level: 'ok', issues: [], memAvailMb: 3000, audioClockPct: -0.17, stallsPerMin: 0, uptimeMin: 63 })
  })
})
