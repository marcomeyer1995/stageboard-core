import { SERVER_MESSAGES_DE, serverMessage } from 'shared-types'
import { afterEach, describe, expect, it } from 'vitest'
import i18n, { resources } from '../i18n'
import { serverErrorText, serverText } from './serverMessage'

function flatten(value: unknown, prefix = ''): Record<string, string> {
  if (typeof value === 'string') return { [prefix]: value }
  return Object.assign({}, ...Object.entries(value as Record<string, unknown>).map(([k, v]) => flatten(v, prefix ? `${prefix}.${k}` : k)))
}

describe('Stage-Server messages in the device language (#679)', () => {
  afterEach(() => void i18n.changeLanguage('de'))

  it("de/server.json says exactly what the server's German fallback says", () => {
    expect(flatten(resources.de!.server)).toEqual(SERVER_MESSAGES_DE)
  })

  it('translates a known code with its values, in the chosen language', async () => {
    const reply = { status: 'error', ...serverMessage('osc.sendFailed', { host: '10.0.0.5', port: 7700, error: 'EHOSTUNREACH' }) }
    expect(serverText(reply)).toBe('OSC an 10.0.0.5:7700 fehlgeschlagen: EHOSTUNREACH')
    await i18n.changeLanguage('en')
    expect(serverText(reply)).toBe('OSC to 10.0.0.5:7700 failed: EHOSTUNREACH')
    expect(serverErrorText({ error: 'Durch einen Neustart des Stage-Servers unterbrochen.', errorCode: 'job.interrupted' })).toBe('Interrupted by a restart of the Stage-Server.')
  })

  it("falls back to the server's own text for a code this app doesn't know, or none", async () => {
    await i18n.changeLanguage('en')
    expect(serverText({ message: 'Neue Meldung', messageCode: 'future.thing' })).toBe('Neue Meldung')
    expect(serverText({ message: 'Track not found' })).toBe('Track not found')
    expect(serverText(null)).toBeUndefined()
  })
})
