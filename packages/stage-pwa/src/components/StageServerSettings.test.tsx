import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStageServerStore } from '../store/useStageServerStore'
import { StageServerSettings } from './StageServerSettings'

beforeEach(() => {
  vi.stubEnv('VITE_STAGE_SERVER_URL', 'https://stageboard.local')
  useStageServerStore.setState({ url: null })
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('StageServerSettings', () => {
  it('shows the automatic address read-only and asks for nothing', () => {
    render(<StageServerSettings />)

    expect(screen.getByText('https://stageboard.local')).toBeInTheDocument()
    expect(screen.getByText('(automatisch)')).toBeInTheDocument()
    expect(screen.queryByText('Zurücksetzen auf automatisch')).not.toBeInTheDocument()
    // The override input exists only inside the collapsed "Erweitert" disclosure.
    expect(screen.getByLabelText('Stage-Server-Adresse').closest('details')).not.toHaveAttribute('open')
  })

  it('flags a manual override openly and resets it back to automatic', () => {
    useStageServerStore.setState({ url: 'https://192.168.178.99' })
    render(<StageServerSettings />)

    expect(screen.getByText('https://192.168.178.99')).toBeInTheDocument()
    expect(screen.getByText('(manuell eingetragen)')).toBeInTheDocument()
    expect(screen.getByText(/ersetzt auf diesem Gerät die automatische \(https:\/\/stageboard\.local\)/)).toBeInTheDocument()

    fireEvent.click(screen.getByText('Zurücksetzen auf automatisch'))

    expect(useStageServerStore.getState().url).toBeNull()
    expect(screen.getByText('(automatisch)')).toBeInTheDocument()
  })

  it('saves a different address as an override', () => {
    render(<StageServerSettings />)

    fireEvent.change(screen.getByLabelText('Stage-Server-Adresse'), { target: { value: 'https://192.168.178.99/' } })
    fireEvent.click(screen.getByText('Speichern'))

    expect(useStageServerStore.getState().url).toBe('https://192.168.178.99')
  })

  it('does not pin the automatic address when it is typed in', () => {
    useStageServerStore.setState({ url: 'https://192.168.178.99' })
    render(<StageServerSettings />)

    fireEvent.change(screen.getByLabelText('Stage-Server-Adresse'), { target: { value: 'https://stageboard.local' } })
    fireEvent.click(screen.getByText('Speichern'))

    expect(useStageServerStore.getState().url).toBeNull()
  })

  it('keeps Speichern disabled while the entry would not change anything', () => {
    render(<StageServerSettings />)
    expect(screen.getByText('Speichern')).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Stage-Server-Adresse'), { target: { value: 'https://stageboard.local/' } })
    expect(screen.getByText('Speichern')).toBeDisabled()
  })
})
