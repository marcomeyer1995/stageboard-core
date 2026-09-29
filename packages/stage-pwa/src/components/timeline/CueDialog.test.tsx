import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { LogicalDevice } from 'shared-types'
import { CueDialog } from './CueDialog'

const devices: LogicalDevice[] = [
  { id: 'mg30', name: 'NUX MG-30', capability: 'mg30-control', pluginId: null, executionTarget: null },
  { id: 'mock', name: 'Mock Playback', capability: 'audio-playback', pluginId: null, executionTarget: null },
]
const select = (label: string) => screen.getByLabelText(label) as HTMLSelectElement

describe('CueDialog (docs/14 §7)', () => {
  it('opens each dropdown only after the one before it, then fills it with what fits', () => {
    render(<CueDialog title="Cue" devices={devices} onSubmit={vi.fn()} onCancel={vi.fn()} />)
    expect(select('Befehl').disabled).toBe(true)
    expect(select('Wert').disabled).toBe(true)
    expect(screen.getByText('Übernehmen')).toBeDisabled()

    fireEvent.change(select('Gerät'), { target: { value: 'mg30' } })
    expect(select('Befehl').disabled).toBe(false)
    expect([...select('Befehl').options].map((o) => o.text)).toEqual(['Befehl wählen…', 'Patch wählen', 'Regler setzen'])

    fireEvent.change(select('Befehl'), { target: { value: 'mg30.setKnob' } })
    expect(select('Regler').disabled).toBe(false)
    expect(select('Wert').disabled).toBe(true) // until a knob is chosen
    expect([...select('Regler').options].map((o) => o.text)).toContain('Amp – Regler 3')

    fireEvent.change(select('Regler'), { target: { value: '24' } })
    expect(select('Wert').disabled).toBe(false)
    expect(screen.getByText('Übernehmen')).toBeDisabled()
  })

  it('submits the command with its values as the translator expects them', () => {
    const onSubmit = vi.fn()
    render(<CueDialog title="Cue" devices={devices} onSubmit={onSubmit} onCancel={vi.fn()} />)
    fireEvent.change(select('Gerät'), { target: { value: 'mg30' } })
    fireEvent.change(select('Befehl'), { target: { value: 'mg30.selectPatch' } })
    expect([...select('Patch').options].slice(1, 3).map((o) => o.text)).toEqual(['01A', '01B'])
    fireEvent.change(select('Patch'), { target: { value: '5' } })
    fireEvent.click(screen.getByText('Übernehmen'))
    expect(onSubmit).toHaveBeenCalledWith({ targetLogicalDeviceId: 'mg30', type: 'mg30.selectPatch', payload: { program: 5 } })
  })

  it('a device without described commands gets the free command and payload fields', () => {
    const onSubmit = vi.fn()
    render(<CueDialog title="Cue" devices={devices} onSubmit={onSubmit} onCancel={vi.fn()} />)
    fireEvent.change(select('Gerät'), { target: { value: 'mock' } })
    fireEvent.change(screen.getByLabelText('Befehl (Typ)'), { target: { value: 'play' } })
    fireEvent.change(screen.getByLabelText('Payload (JSON, optional)'), { target: { value: '{"track": 2}' } })
    fireEvent.click(screen.getByText('Übernehmen'))
    expect(onSubmit).toHaveBeenCalledWith({ targetLogicalDeviceId: 'mock', type: 'play', payload: { track: 2 } })
  })

  it('changing the device clears the command and values chosen for the old one', () => {
    render(<CueDialog title="Cue" devices={devices} initial={{ targetLogicalDeviceId: 'mg30', type: 'mg30.selectPatch', payload: { program: 5 } }} onSubmit={vi.fn()} onCancel={vi.fn()} />)
    expect(select('Patch').value).toBe('5')
    fireEvent.change(select('Gerät'), { target: { value: 'mock' } })
    fireEvent.change(select('Gerät'), { target: { value: 'mg30' } })
    expect(select('Befehl').value).toBe('')
  })
})
