import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { PinInput } from './PinInput'

function Harness() {
  const [pin, setPin] = useState('')
  return <PinInput value={pin} onChange={setPin} placeholder="PIN" />
}

describe('PinInput (#898)', () => {
  it('is masked by default, with the numeric keypad', () => {
    render(<Harness />)
    const input = screen.getByPlaceholderText('PIN') as HTMLInputElement
    expect(input.type).toBe('password')
    expect(input.inputMode).toBe('numeric')
  })

  it('keeps digits only, at most four', () => {
    render(<Harness />)
    const input = screen.getByPlaceholderText('PIN') as HTMLInputElement
    fireEvent.change(input, { target: { value: '12a3-456' } })
    expect(input.value).toBe('1234')
  })

  it('the eye button shows and hides the PIN', () => {
    render(<Harness />)
    const input = screen.getByPlaceholderText('PIN') as HTMLInputElement
    const eye = screen.getByRole('button')
    fireEvent.click(eye)
    expect(input.type).toBe('text')
    expect(eye.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(eye)
    expect(input.type).toBe('password')
  })
})
