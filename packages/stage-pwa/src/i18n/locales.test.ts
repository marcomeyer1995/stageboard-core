import { describe, expect, it } from 'vitest'
import { DEFAULT_LANGUAGE, LANGUAGES, resolveLanguage, resources } from '.'

/** Every key path of a nested text file, with its placeholders: `state.ready` -> [] */
function flatten(value: unknown, prefix = ''): Map<string, string[]> {
  const out = new Map<string, string[]>()
  if (typeof value === 'string') {
    out.set(prefix, [...value.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]!).sort())
    return out
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    for (const [k, v] of flatten(child, prefix ? `${prefix}.${key}` : key)) out.set(k, v)
  }
  return out
}

describe('the bundled languages (#456)', () => {
  const reference = resources[DEFAULT_LANGUAGE]!

  it('German and English are there, each named in itself', () => {
    expect(LANGUAGES).toEqual(expect.arrayContaining([{ code: 'de', name: 'Deutsch' }, { code: 'en', name: 'English' }]))
  })

  for (const { code } of LANGUAGES.filter((l) => l.code !== DEFAULT_LANGUAGE)) {
    it(`${code} has every German text file, key and placeholder - and nothing German doesn't have`, () => {
      expect(Object.keys(resources[code]!).sort()).toEqual(Object.keys(reference).sort())
      for (const namespace of Object.keys(reference)) {
        const de = flatten(reference[namespace])
        const other = flatten(resources[code]![namespace])
        expect([...other.keys()].sort(), `${code}/${namespace}.json keys`).toEqual([...de.keys()].sort())
        for (const [key, placeholders] of de) expect(other.get(key), `${code}/${namespace}.json ${key}`).toEqual(placeholders)
      }
    })
  }

  it('no empty text anywhere', () => {
    for (const [code, namespaces] of Object.entries(resources)) {
      for (const [namespace, content] of Object.entries(namespaces)) {
        for (const [key] of [...flatten(content)].filter(([k]) => {
          const value = k.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], content)
          return typeof value !== 'string' || value.trim() === ''
        })) throw new Error(`${code}/${namespace}.json ${key} is empty`)
      }
    }
  })
})

describe('resolveLanguage (#456)', () => {
  it('a chosen language wins; "auto" follows the device; German when the device language is unknown', () => {
    expect(resolveLanguage('en', ['de-DE'])).toBe('en')
    expect(resolveLanguage('auto', ['en-GB', 'de'])).toBe('en')
    expect(resolveLanguage('auto', ['fr-FR', 'de-AT'])).toBe('de')
    expect(resolveLanguage('auto', ['ja-JP'])).toBe('de')
    // A language this build no longer has (removed folder): back to the device's.
    expect(resolveLanguage('xx', ['en-US'])).toBe('en')
  })
})
