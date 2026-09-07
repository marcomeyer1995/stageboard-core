import { getDeviceId } from '../lib/deviceId'
import { useDiscoverySessionStore } from '../store/useDiscoverySessionStore'

/**
 * The visible half of Discovery Mode's trigger-based disambiguation (useDiscoveryTrigger.ts owns
 * the actual MIDI listening) - while the session is asking a musician to physically identify a
 * role, and *this* tablet has a candidate device in contention for it, shows what to do. Purely
 * reactive off useDiscoverySessionStore - no local state, no dialog/modal (this shouldn't block
 * the rest of the UI while the musician goes and touches their gear).
 */
export function DiscoveryBanner() {
  const identifying = useDiscoverySessionStore((state) => state.session.identifying)
  const isOwnContender = useDiscoverySessionStore((state) =>
    identifying
      ? state.session.candidates.some(
          (c) => c.reporterId === getDeviceId() && c.status === 'identifying' && c.matchedPluginId === identifying.pluginId,
        )
      : false,
  )

  if (!identifying || !isOwnContender) return null

  return (
    <div className="fixed inset-x-0 top-0 z-40 flex items-center justify-center gap-2 bg-accent px-4 py-3 text-center text-sm font-semibold text-accent-ink shadow-sb">
      <span>
        Geräte-Erkennung — „{identifying.logicalDeviceName}": {identifying.instruction}
      </span>
    </div>
  )
}
