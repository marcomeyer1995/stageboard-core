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
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-4 bg-red-950 p-8 text-center text-white">
      <span className="text-5xl">🚫</span>
      <h1 className="text-xl font-bold">Dieses Gerät wurde entfernt</h1>
      <p className="max-w-sm text-sm text-red-200">
        Ein Admin hat dieses Gerät aus der Band entfernt. Wende dich an einen Admin, wenn das ein
        Irrtum war - sobald das Gerät wieder zugelassen wird, geht es hier automatisch weiter.
      </p>
    </div>
  )
}
