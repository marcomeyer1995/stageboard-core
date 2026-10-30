import { useTranslation } from 'react-i18next'
import { Icon } from './Icon'
/**
 * The actual "kick" behind the Device Ledger's admin revoke action (DeviceLedgerView.tsx,
 * Marco's explicit request) - a soft, cooperative lockout, not a hard security boundary
 * (confirmed with Marco: this app's auth model is per-profile CouchDB accounts, not
 * per-device, so there's no credential to actually revoke - see device.ts's `revoked` doc
 * comment). Purely a render gate reacting to the live-synced `revoked` flag on this device's
 * own entry (App.tsx checks it before anything else renders) - no credential wipe, no forced
 * logout plumbing. Restoring the device in the ledger flips `revoked` back to `false`, which
 * this same synced doc already carries to every device via the ordinary CouchDB sync everyone
 * runs regardless - so un-revoking is immediately and automatically reversible, with nothing
 * for the device itself to redo.
 */
export function DeviceRevokedScreen() {
  const { t } = useTranslation('common')
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-alarm p-8 text-center text-alarm-ink">
      <Icon name="blocked" size="3.5rem" />
      <h1 className="text-xl font-bold">{t('rv.title')}</h1>
      <p className="max-w-sm text-sm text-alarm-ink/80">
        {t('rv.text')}
      </p>
    </div>
  )
}
