import { CAPABILITIES } from 'shared-types'
import { MixFaders } from '../components/MixFaders'
import { useShowMode } from '../lib/showMode'
import { stageFontSize } from '../lib/stageSize'
import { useCapabilityRouting } from '../lib/useCapabilityRouting'
import { useElementSize } from '../lib/useElementSize'
import { useContentFontSizeStore } from '../store/useContentFontSizeStore'
import { DEFAULT_SIZE_RATIO, type AudioMixConfig } from './audioMixConfig'
import { SizeRatioSlider } from './SizeRatioSlider'

/** Below this the faders turn horizontal: fader, value and a 56 px chip need about this much. */
const VERTICAL_MIN_H = 260
const VERTICAL_MIN_W = 330

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
  // Vertical faders need height: in a short or narrow widget (the phone's grid) they shrank to
  // 30 px and the three "Stumm" chips overlapped (2026-10-16) - one row per source instead.
  const [boxRef, box] = useElementSize()
  const horizontal = box.width > 0 && (box.height < VERTICAL_MIN_H || box.width < VERTICAL_MIN_W)

  return (
    <div ref={boxRef} className={`flex h-full w-full flex-col gap-2 ${horizontal ? 'overflow-y-auto' : ''}`}>
      <div className="min-h-0 flex-1">
        <MixFaders orientation={horizontal ? 'horizontal' : 'vertical'} fontSize={fontSize} size="stage" />
      </div>
      {silentHere && <p className="text-base text-ink-faint">Im Gig spielt dieses Gerät keinen Ton - der Mix gilt hier fürs Üben und die Timeline.</p>}
    </div>
  )
}

export function AudioMixConfigPanel({ config, onChange }: { config: AudioMixConfig; onChange: (next: AudioMixConfig) => void }) {
  return <SizeRatioSlider label="Größe" ratio={config.sizeRatio ?? DEFAULT_SIZE_RATIO} onChange={(sizeRatio) => onChange({ ...config, sizeRatio })} />
}
