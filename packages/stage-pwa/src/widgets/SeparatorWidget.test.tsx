import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { SeparatorWidget } from './SeparatorWidget'
import type { SeparatorConfig } from './separatorConfig'

function config(overrides: Partial<SeparatorConfig> = {}): SeparatorConfig {
  return { orientation: 'horizontal', color: 'neutral', ...overrides }
}

describe('SeparatorWidget', () => {
  it('renders a horizontal line using the configured color', () => {
    const { container } = render(<SeparatorWidget config={config({ color: 'accent' })} />)
    const line = container.firstElementChild!.firstElementChild!
    expect(line).toHaveClass('bg-accent')
    expect(line).toHaveClass('w-full')
  })

  it('renders a vertical line for the vertical orientation', () => {
    const { container } = render(<SeparatorWidget config={config({ orientation: 'vertical', color: 'red' })} />)
    const line = container.firstElementChild!.firstElementChild!
    expect(line).toHaveClass('bg-red-500')
    expect(line).toHaveClass('h-full')
  })

  it('defaults to a visible neutral color, not the near-invisible line token', () => {
    const { container } = render(<SeparatorWidget config={config()} />)
    const line = container.firstElementChild!.firstElementChild!
    expect(line).toHaveClass('bg-ink-muted')
  })
})
