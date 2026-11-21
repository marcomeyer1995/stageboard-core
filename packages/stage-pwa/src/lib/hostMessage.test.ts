import { SERVER_MESSAGES_DE, hostMessage } from 'shared-types'
import { afterEach, describe, expect, it } from 'vitest'
import i18n, { resources } from '../i18n'
import { hostErrorText, hostText } from './hostMessage'

function flatten(value: unknown, prefix = ''): Record<string, string> {
  if (typeof value === 'string') return { [prefix]: value }
  return Object.assign({}, ...Object.entries(value as Record<string, unknown>).map(([k, v]) => flatten(v, prefix ? `${prefix}.${k}` : k)))
}

describe('Host messages in the device language (#679)', () => {
  afterEach(() => void i18n.changeLanguage('de'))

  it("de/server.json says exactly what the server's German fallback says", () => {
    expect(flatten(resources.de!.server)).toEqual(SERVER_MESSAGES_DE)
  })

  it('translates a known code with its values, in the chosen language', async () => {
    const reply = { status: 'error', ...hostMessage('speech.notInstalled', { voice: 'thorsten' }) }
    expect(hostText(reply)).toBe('Piper oder Stimme thorsten nicht installiert')
    await i18n.changeLanguage('en')
    expect(hostText(reply)).toMatch(/thorsten/)
    expect(hostErrorText({ error: 'Durch einen Neustart des Hosts unterbrochen.', errorCode: 'job.interrupted' })).toBe('Interrupted by a restart of the Host.')
  })

  it("falls back to the server's own text for a code this app doesn't know, or none", async () => {
    await i18n.changeLanguage('en')
    expect(hostText({ message: 'Neue Meldung', messageCode: 'future.thing' })).toBe('Neue Meldung')
    expect(hostText({ message: 'Track not found' })).toBe('Track not found')
    expect(hostText(null)).toBeUndefined()
  })
})
