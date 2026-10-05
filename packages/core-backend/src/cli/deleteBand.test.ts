import { describe, expect, it } from 'vitest'
import { planDeletion, type Band } from './deleteBand.js'

const bands: Band[] = [
  { workspaceId: 'aaa', workspaceName: 'devclaim-test-band' },
  { workspaceId: 'bbb', workspaceName: 'SOAT' },
  { workspaceId: 'ccc', workspaceName: 'Abadschendaler' },
]

describe('band:delete planDeletion', () => {
  it('lists the bands without arguments', () => {
    expect(planDeletion([], bands, 'ccc')).toEqual({ kind: 'list' })
  })

  it('deletes only with the exact name typed', () => {
    expect(planDeletion(['aaa', '--confirm', 'devclaim-test-band'], bands, 'ccc')).toEqual({ kind: 'delete', band: bands[0] })
    expect(planDeletion(['aaa'], bands, 'ccc').kind).toBe('error')
    expect(planDeletion(['aaa', '--confirm', 'devclaim'], bands, 'ccc').kind).toBe('error')
    expect(planDeletion(['bbb', '--confirm', 'devclaim-test-band'], bands, 'ccc').kind).toBe('error')
  })

  it('never deletes the band the server is serving', () => {
    const plan = planDeletion(['ccc', '--confirm', 'Abadschendaler'], bands, 'ccc')
    expect(plan.kind).toBe('error')
    expect(plan.kind === 'error' && plan.message).toContain('aktive Band')
  })

  it('reports an unknown id', () => {
    expect(planDeletion(['zzz', '--confirm', 'x'], bands, 'ccc')).toEqual({
      kind: 'error',
      message: 'Keine Band mit der ID zzz auf diesem Stage-Server.',
    })
  })
})
