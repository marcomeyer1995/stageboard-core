import { describe, expect, it } from 'vitest'
import { canEditDashboard } from './dashboardLayout'

describe('canEditDashboard (#16)', () => {
  it('templates are admin-only, everything else stays editable', () => {
    expect(canEditDashboard({}, [])).toBe(true)
    expect(canEditDashboard({ isReadOnly: true }, ['crew'])).toBe(false)
    expect(canEditDashboard({ isReadOnly: true }, ['admin'])).toBe(true)
  })
})
