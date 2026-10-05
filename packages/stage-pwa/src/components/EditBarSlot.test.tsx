import { render, screen } from '@testing-library/react'
import { createPortal } from 'react-dom'
import { describe, expect, it } from 'vitest'
import { useEditBarSlot } from '../lib/useEditBarSlot'
import { EditBarSlot } from './EditBarSlot'

function Portalled({ editing }: { editing: boolean }) {
  const slot = useEditBarSlot(editing)
  return slot ? createPortal(<span>Edit-Leiste</span>, slot) : null
}

describe('EditBarSlot (#370)', () => {
  it('takes the status bar height and receives the edit bar while editing', () => {
    const { container, rerender } = render(
      <>
        <EditBarSlot />
        <Portalled editing />
      </>,
    )
    const slot = container.querySelector('#dashboard-edit-bar-slot')!
    expect(slot.className).toContain('h-14')
    expect(slot).toContainElement(screen.getByText('Edit-Leiste'))
    rerender(
      <>
        <EditBarSlot />
        <Portalled editing={false} />
      </>,
    )
    expect(screen.queryByText('Edit-Leiste')).not.toBeInTheDocument()
  })
})
