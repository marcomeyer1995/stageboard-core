import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({ code: 420, offered: null as { versionCode: number; versionName: string } | null, installAppUpdate: vi.fn(async () => {}) }))
vi.mock('../lib/native', () => ({
  get APP_VERSION_CODE() {
    return native.code
  },
  fetchOfferedAppVersion: async () => native.offered,
  installAppUpdate: native.installAppUpdate,
}))

const { AppVersionSettings } = await import('./AppVersionSettings')

describe('AppVersionSettings (#348)', () => {
  it('shows the installed version and finds a newer one on demand', async () => {
    native.offered = { versionCode: 421, versionName: '1.421 (abc1234)' }
    render(<AppVersionSettings />)
    expect(screen.getByText('Installiert: Version 1.420')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Nach Update suchen'))
    fireEvent.click(await screen.findByText('Version 1.421 (abc1234) installieren'))
    expect(native.installAppUpdate).toHaveBeenCalled()
  })

  it('says when the app is current, or when the server offers none', async () => {
    native.offered = { versionCode: 420, versionName: '1.420' }
    const { unmount } = render(<AppVersionSettings />)
    fireEvent.click(screen.getByText('Nach Update suchen'))
    expect(await screen.findByText('Aktuell – der Stage-Server hat keine neuere Version.')).toBeInTheDocument()
    unmount()

    native.offered = null
    render(<AppVersionSettings />)
    fireEvent.click(screen.getByText('Nach Update suchen'))
    expect(await screen.findByText('Der Stage-Server bietet keine App an (oder ist nicht erreichbar).')).toBeInTheDocument()
  })

  it('a dev build (StageBoard Dev) offers no server update - it would install as the real app beside it', () => {
    native.code = 0
    render(<AppVersionSettings />)
    expect(screen.getByText('Installiert: Entwicklungs-Build')).toBeInTheDocument()
    expect(screen.queryByText('Nach Update suchen')).not.toBeInTheDocument()
    expect(screen.getByText(/Updates für den Entwicklungs-Build kommen per adb/)).toBeInTheDocument()
    native.code = 420
  })
})
