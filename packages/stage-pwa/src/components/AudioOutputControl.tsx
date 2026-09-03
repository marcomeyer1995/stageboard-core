import { claimAudioOutput, releaseAudioOutput } from '../lib/queue'
import { useShowStateStore } from '../store/useShowStateStore'

/**
 * First slice of #10 (Logical Devices & Hardware Setup Profiles): lets this device claim
 * itself as tonight's live audio-output, bypassing the Stage-Server plugin entirely - e.g.
 * only one of two guitarists could make it, so the remaining one's own tablet becomes the
 * audio output for tonight instead of routing through a dedicated interface. Gig mode only
 * (Practice mode always plays locally already, nothing to claim) - see ShowTransportWidget.tsx
 * for how the claim actually changes which engine plays audio.
 *
 * No device registry yet: a device other than this one just shows as "Anderes Gerät" - naming
 * it would need the fuller #10 (a real DeviceRegistry), deliberately deferred for this slice.
 */
export function AudioOutputControl() {
  const isMaster = useShowStateStore((state) => state.isMaster)
  const clientId = useShowStateStore((state) => state.clientId)
  const audioOutputDeviceId = useShowStateStore((state) => state.state.audioOutputDeviceId)
  const isMine = audioOutputDeviceId === clientId

  return (
    <div className="flex h-12 items-center justify-between rounded-sb bg-control px-4 text-base text-ink-soft">
      Audio-Ausgabe
      {audioOutputDeviceId === null ? (
        <button
          type="button"
          onClick={() => void claimAudioOutput()}
          disabled={!isMaster}
          title="Backing-Track über dieses Gerät statt über ein Stage-Server-Plugin abspielen"
          className="font-medium text-accent hover:underline disabled:cursor-not-allowed disabled:opacity-40 disabled:no-underline"
        >
          Dieses Gerät übernehmen
        </button>
      ) : (
        <div className="flex items-center gap-3">
          <span className={`text-sm ${isMine ? 'text-accent' : 'text-ink-faint'}`}>
            {isMine ? 'Dieses Gerät' : 'Anderes Gerät'}
          </span>
          <button
            type="button"
            onClick={() => void releaseAudioOutput()}
            disabled={!isMaster}
            className="text-sm font-medium text-ink-soft hover:underline disabled:cursor-not-allowed disabled:opacity-40 disabled:no-underline"
          >
            Freigeben
          </button>
        </div>
      )}
    </div>
  )
}
