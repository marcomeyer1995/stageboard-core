import { describe, expect, it } from 'vitest'

/**
 * Guard for the UI system (docs/15, phase 5): the harmonised rules hold for every screen, not
 * just the ones converted in #423. Each rule names the place it was broken, so a failure says
 * what to use instead. Reads the sources as text - no rendering, so it stays fast.
 */
const sources = import.meta.glob(['../../**/*.tsx', '!../../**/*.test.tsx', '!./**', '!../UiPreview.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

function offending(pattern: RegExp, { skipComments = true }: { skipComments?: boolean } = {}): string[] {
  const hits: string[] = []
  for (const [path, text] of Object.entries(sources)) {
    text.split('\n').forEach((line, index) => {
      const trimmed = line.trim()
      if (skipComments && (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*') || trimmed.startsWith('{/*'))) return
      if (pattern.test(line)) hits.push(`${path.replace('../../', 'src/')}:${index + 1}`)
    })
  }
  return hits
}

describe('UI system guard (docs/15)', () => {
  it('reads the sources', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(100)
  })

  it('corners by role: rounded-control or rounded-container, never the old rounded-sb / rounded-sb-sm', () => {
    expect(offending(/(?<![\w-])rounded-sb(-sm)?(?![\w-])/)).toEqual([])
  })

  it('hover only where a mouse hovers - a bare hover: sticks after a tap on touchscreens', () => {
    expect(offending(/(^|[\s'"`])hover:(?=[a-z])/)).toEqual([])
  })

  it('on/off is a Switch, pick-several a ToggleChip or CheckRow - no native checkboxes', () => {
    expect(offending(/type="checkbox"/)).toEqual([])
  })

  it('pick one is a Segmented bar or radio rows - no native radio buttons', () => {
    expect(offending(/type="radio"/)).toEqual([])
  })

  it('main actions are yellow (accent) - no buttons in the second accent colour', () => {
    expect(offending(/['"`][^'"`]*bg-accent-2(?![\w/-])/)).toEqual([])
  })

  it('no buttons below the form height: h-7 to h-11 on controls', () => {
    expect(offending(/(?<![\w-])(min-)?h-(7|8|9|10|11)(?![\w-]).*(rounded-control|bg-control|bg-accent)|(rounded-control|bg-control|bg-accent).*(?<![\w-])(min-)?h-(7|8|9|10|11)(?![\w-])/)).toEqual([])
  })

  it('dialogs have one way out at the bottom - no "Schließen" button left over', () => {
    expect(offending(/>\s*Schließen\s*</)).toEqual([])
  })
})
