import { CAPABILITIES } from 'shared-types'
import { MixFaders } from '../components/MixFaders'
import { useShowMode } from '../lib/showMode'
import { stageFontSize } from '../lib/stageSize'
import { useCapabilityRouting } from '../lib/useCapabilityRouting'
import { useContentFontSizeStore } from '../store/useContentFontSizeStore'
import { DEFAULT_SIZE_RATIO, type AudioMixConfig } from './audioMixConfig'
import { SizeRatioSlider } from './SizeRatioSlider'

/**
 * "Mein Mix" (docs/21 §9.3): how loud Track, Klick and Ansagen play on this device - the same
 * sliders as the Timeline editor's "Mix". In Gig mode a device that plays none of them says so:
 * its mix then only matters for Solo practice and the Timeline.
 */
export function AudioMixWidget({ config }: { config: AudioMixConfig }) {
  const { mode } = useShowMode()
  const click = useCapabilityRouting(CAPABILITIES.clickTrack, mode).engine
  const track = useCapabilityRouting(CAPABILITIES.audioPlayback, mode).engine
  const baseFontSize = useContentFontSizeStore((state) => state.baseFontSize)
  const fontSize = stageFontSize(baseFontSize * (config.sizeRatio ?? DEFAULT_SIZE_RATIO))
  const silentHere = mode === 'gig' && click !== 'local-mine' && track !== 'local-mine'

  return (
    <div className="flex h-full w-full flex-col gap-2">
      <div className="min-h-0 flex-1">
        <MixFaders orientation="vertical" fontSize={fontSize} size="stage" />
      </div>
      {silentHere && <p className="text-base text-ink-faint">Im Gig spielt dieses Gerät keinen Ton - der Mix gilt hier fürs Üben und die Timeline.</p>}
    </div>
  )
}

export function AudioMixConfigPanel({ config, onChange }: { config: AudioMixConfig; onChange: (next: AudioMixConfig) => void }) {
  return <SizeRatioSlider label="Größe" ratio={config.sizeRatio ?? DEFAULT_SIZE_RATIO} onChange={(sizeRatio) => onChange({ ...config, sizeRatio })} />
}
