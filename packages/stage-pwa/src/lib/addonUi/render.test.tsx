import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { UiNode } from 'shared-types'
import { UiTree } from './render'

const sources = { jobs: { abc: { progress: 0.4 } }, state: { qlc: { scene: 'b', level: 0.25 } } }
const show = (tree: unknown, onAction = vi.fn()) => (render(<UiTree tree={tree as UiNode} sources={sources} onAction={onAction} />), onAction)

describe('UiTree - every node is one component of the UI system (#964, docs/36 §6)', () => {
  it('text is plain text: markup is shown as written, never interpreted', () => {
    const { container } = render(<UiTree tree={{ type: 'text', role: 'body', text: '<b onclick="x()">hi</b><img src=x>' } as UiNode} sources={sources} onAction={vi.fn()} />)
    expect(screen.getByText('<b onclick="x()">hi</b><img src=x>')).toBeInTheDocument()
    expect(container.querySelector('b, img')).toBeNull()
  })

  it('a button is a Button of its variant; a tap sends exactly its action once', () => {
    const onAction = show({ type: 'button', variant: 'danger', label: 'Delete', action: 'delete' })
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveClass('text-danger')
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onAction).toHaveBeenCalledTimes(1)
    expect(onAction).toHaveBeenCalledWith('delete', undefined)
  })

  it('a field is a labelled input: typing sends change:<id> with the text and keeps what was typed', () => {
    const onAction = show({ type: 'field', id: 'query', label: 'Search', value: '' })
    const input = screen.getByLabelText('Search') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'wonder' } })
    expect(onAction).toHaveBeenCalledWith('change:query', 'wonder')
    expect(input.value).toBe('wonder')
  })

  it('a switch, a select, a slider and chips report their value', () => {
    const onAction = show({ type: 'stack', children: [
      { type: 'switch', id: 'on', label: 'Enabled', value: false },
      { type: 'select', id: 'sel', label: 'Pick', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], value: 'a' },
      { type: 'slider', id: 'lvl', label: 'Level', min: 0, max: 1, step: 0.1, value: 0.2 },
      { type: 'chips', id: 'ch', options: [{ value: 'x', label: 'X' }, { value: 'y', label: 'Y' }], value: [] },
    ] })
    fireEvent.click(screen.getByRole('switch', { name: /Enabled/ }))
    expect(onAction).toHaveBeenLastCalledWith('change:on', true)
    fireEvent.change(screen.getByLabelText('Pick'), { target: { value: 'b' } })
    expect(onAction).toHaveBeenLastCalledWith('change:sel', 'b')
    fireEvent.change(screen.getByLabelText('Level'), { target: { value: '0.7' } })
    expect(onAction).toHaveBeenLastCalledWith('change:lvl', 0.7)
    fireEvent.click(screen.getByText('Y'))
    expect(onAction).toHaveBeenLastCalledWith('change:ch', ['y'])
  })

  it('a list row shows title, subtitle and a thumbnail the app loads without a referrer; tapping it sends its action', () => {
    const onAction = show({ type: 'list', children: [{ type: 'listRow', title: 'Wonderwall', subtitle: '4:18', image: { src: 'https://i.ytimg.com/vi/x.jpg', role: 'thumb' }, action: 'pick:x' }] })
    expect(screen.getByText('Wonderwall')).toBeInTheDocument()
    expect(screen.getByText('4:18')).toBeInTheDocument()
    const img = document.querySelector('img')!
    expect(img.getAttribute('src')).toBe('https://i.ytimg.com/vi/x.jpg')
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer')
    fireEvent.click(screen.getByText('Wonderwall'))
    expect(onAction).toHaveBeenCalledWith('pick:x', undefined)
  })

  it('a bound progress follows the job document - a new source value re-renders with NO action sent', () => {
    const onAction = vi.fn()
    const tree = { type: 'progress', value: { bind: 'job:abc.progress' } } as UiNode
    const { rerender } = render(<UiTree tree={tree} sources={sources} onAction={onAction} />)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40')
    rerender(<UiTree tree={tree} sources={{ ...sources, jobs: { abc: { progress: 0.9 } } }} onAction={onAction} />)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '90')
    expect(onAction).not.toHaveBeenCalled()
  })

  it('a bound text and a bound switch show the device state', () => {
    show({ type: 'stack', children: [{ type: 'text', role: 'title', text: { bind: 'state:qlc.scene' } }, { type: 'slider', id: 'l', label: 'Level', min: 0, max: 1, value: { bind: 'state:qlc.level' } }] })
    expect(screen.getByText('b')).toBeInTheDocument()
    expect((screen.getByLabelText('Level') as HTMLInputElement).value).toBe('0.25')
  })

  it('a dialog is a Dialog: closing sends the action "close"; an unknown icon renders without one instead of failing', () => {
    const onAction = show({ type: 'dialog', size: 'M', title: 'From YouTube', children: [{ type: 'iconButton', icon: 'no-such-icon', label: 'Go', action: 'go' }] })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Go' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Fertig' }))
    expect(onAction).toHaveBeenCalledWith('close', undefined)
  })
})

describe('UiTree link (#964)', () => {
  it('a link is a quiet Button that opens its target in a new window with no opener and no referrer', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    show({ type: 'link', label: 'Ansehen', href: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })
    fireEvent.click(screen.getByRole('button', { name: 'Ansehen' }))
    expect(open).toHaveBeenCalledWith('https://www.youtube.com/watch?v=dQw4w9WgXcQ', '_blank', 'noopener,noreferrer')
    open.mockRestore()
  })

  it('inside a list row the link does not trigger the row\'s own action', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    const onAction = show({ type: 'list', children: [{ type: 'listRow', title: 'Wonderwall', action: 'pick:0', trailing: { type: 'link', label: 'Ansehen', href: 'https://www.youtube.com/watch?v=x' } }] })
    fireEvent.click(screen.getByRole('button', { name: 'Ansehen' }))
    expect(open).toHaveBeenCalledTimes(1)
    expect(onAction).not.toHaveBeenCalled()
    open.mockRestore()
  })
})
