import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearStageServerLog,
  getStageServerLogLines,
  setStageServerDebugEnabled,
  stageServerDebugEnabled,
  stageServerLog,
  subscribeStageServerLog,
} from './stageServerDebug'

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('stageServerDebug', () => {
  it('records nothing while the flag is off', () => {
    stageServerLog('ignored')

    expect(getStageServerLogLines()).toEqual([])
    expect(console.log).not.toHaveBeenCalled()
  })

  it('records lines (and mirrors them to the console) once switched on, with no reload needed', () => {
    setStageServerDebugEnabled(true)

    stageServerLog('listWorkspaces', 'ok', '12ms total')

    expect(stageServerDebugEnabled()).toBe(true)
    expect(getStageServerLogLines().map((l) => l.text)).toEqual(['listWorkspaces ok 12ms total'])
    expect(console.log).toHaveBeenCalledWith('[stageServer]', 'listWorkspaces', 'ok', '12ms total')
  })

  it('the switch is persisted in localStorage, and switching off stops recording again', () => {
    setStageServerDebugEnabled(true)
    expect(localStorage.getItem('sb:debug:stageServer')).toBe('1')

    setStageServerDebugEnabled(false)
    stageServerLog('ignored')

    expect(localStorage.getItem('sb:debug:stageServer')).toBeNull()
    expect(getStageServerLogLines()).toEqual([])
  })

  it('keeps only the newest 80 lines', () => {
    setStageServerDebugEnabled(true)
    for (let i = 1; i <= 100; i++) stageServerLog(`line ${i}`)

    const lines = getStageServerLogLines()
    expect(lines).toHaveLength(80)
    expect(lines[0].text).toBe('line 21')
    expect(lines[79].text).toBe('line 100')
  })

  it('clear empties the log', () => {
    setStageServerDebugEnabled(true)
    stageServerLog('x')

    clearStageServerLog()

    expect(getStageServerLogLines()).toEqual([])
  })

  it('notifies subscribers on a new line, a clear and a toggle, and stops after unsubscribing', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeStageServerLog(listener)

    setStageServerDebugEnabled(true)
    stageServerLog('x')
    clearStageServerLog()
    expect(listener).toHaveBeenCalledTimes(3)

    unsubscribe()
    stageServerLog('y')
    expect(listener).toHaveBeenCalledTimes(3)
  })
})
