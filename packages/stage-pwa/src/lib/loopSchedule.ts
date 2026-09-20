/**
 * Pure timing maths of the Rehearsal Looper / Speed Trainer (#61), kept free of Web Audio so
 * the engine (loopTrainerEngine.ts) and every clock consumer derive the exact same position
 * from the same schedule, and it can be unit-tested without an AudioContext.
 *
 * A loop plays the section [startMs, endMs] over and over. Each pass runs at one playback
 * rate (1 = original tempo); the Speed Trainer raises it by `step` per pass until `target`.
 */

export interface LoopSpeedConfig {
  /** Fractions of the original tempo, e.g. 0.8 = 80 %. */
  startRate: number
  targetRate: number
  /** Added per completed pass. 0 (or a start at/above the target) means a fixed tempo. */
  step: number
}

export const MIN_RATE = 0.25
export const MAX_RATE = 1.5

/** The rate of every pass up to (and including) the first one at the target - the final rate
 * then holds for all later passes. Float noise from repeated addition is rounded away so
 * 0.7 + 3 * 0.1 lands on exactly 1. */
export function passRates(config: LoopSpeedConfig): number[] {
  const start = clampRate(config.startRate)
  const target = clampRate(config.targetRate)
  if (config.step <= 0 || start >= target) return [start]
  const rates: number[] = []
  for (let rate = start; rate < target - 1e-9; rate = round4(rate + config.step)) rates.push(rate)
  rates.push(target)
  return rates
}

export interface LoopPosition {
  /** 0-based count of completed-plus-current passes. */
  pass: number
  rate: number
  /** Media time inside the loop, from its start (0) up to its length. */
  offsetMs: number
}

/**
 * Where playback is `wallSec` seconds after the loop started. Every pass covers the whole
 * loop, so a pass at rate r takes `lengthMs / r` of wall time; the last rate repeats forever.
 */
export function positionAt(rates: readonly number[], lengthMs: number, wallSec: number): LoopPosition {
  const wallMs = Math.max(0, wallSec) * 1000
  let elapsed = 0
  for (let pass = 0; pass < rates.length - 1; pass++) {
    const passWallMs = lengthMs / rates[pass]
    if (wallMs < elapsed + passWallMs) {
      return { pass, rate: rates[pass], offsetMs: (wallMs - elapsed) * rates[pass] }
    }
    elapsed += passWallMs
  }
  const lastIndex = rates.length - 1
  const lastRate = rates[lastIndex]
  const mediaMs = (wallMs - elapsed) * lastRate
  return {
    pass: lastIndex + Math.floor(mediaMs / lengthMs),
    rate: lastRate,
    offsetMs: mediaMs % lengthMs,
  }
}

/** Wall-clock second (relative to the loop start) at which pass `pass` begins - for scheduling
 * the sample-accurate rate change at every boundary. */
export function passStartSec(rates: readonly number[], lengthMs: number, pass: number): number {
  let ms = 0
  for (let index = 0; index < pass; index++) ms += lengthMs / rates[Math.min(index, rates.length - 1)]
  return ms / 1000
}

export function clampRate(rate: number): number {
  return Math.min(MAX_RATE, Math.max(MIN_RATE, rate))
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000
}
