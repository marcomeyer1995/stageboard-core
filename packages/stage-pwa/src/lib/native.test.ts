import { describe, expect, it } from 'vitest'
import { isNativeApp, pairingConfirmation, shortFingerprint } from './native'

describe('native app helpers (#348)', () => {
  it('is the browser in tests', () => {
    expect(isNativeApp()).toBe(false)
  })

  it('shows the first 8 bytes of a fingerprint for comparing by eye', () => {
    expect(shortFingerprint('0447f3e8fd0f1fd42a4c52086ff133d33a1c7f1bcae81a8633efc3e5ef454951')).toBe('04 47 F3 E8 FD 0F 1F D4')
  })
})

describe('pairingConfirmation (#377)', () => {
  const fp = '0447f3e8fd0f1fd42a4c52086ff133aa0447f3e8fd0f1fd42a4c52086ff133aa'

  it('asks a short question and puts name, address and fingerprint on their own lines', () => {
    const { title, message } = pairingConfirmation('StageBoard Probe', '192.168.178.158', fp)
    expect(title).toBe('Mit diesem Stage-Server verbinden?')
    expect(message.split('\n')).toEqual([
      'StageBoard Probe',
      '192.168.178.158',
      '',
      `Zertifikat: ${shortFingerprint(fp)}`,
      'Zum Vergleich steht es auf dem Admin-Gerät unter „Einladen“.',
    ])
  })

  it('does not repeat the address when the server has no own name', () => {
    expect(pairingConfirmation('192.168.178.158', '192.168.178.158', fp).message.split('\n')[0]).toBe('192.168.178.158')
    expect(pairingConfirmation('192.168.178.158', '192.168.178.158', fp).message.split('\n')[1]).toBe('')
  })
})

