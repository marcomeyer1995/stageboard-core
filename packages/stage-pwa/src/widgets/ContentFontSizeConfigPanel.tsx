import { DEFAULT_SIZE_RATIO, type ContentFontSizeConfig } from './contentFontSizeConfig'
import { SizeRatioSlider } from './SizeRatioSlider'

/** Shared by every list/scrolling-content widget's ConfigPanel (Prompter, Live-Queue,
 * Show-Notizen, System-Status) - this one instance's text size, as a ratio of the
 * device-wide default (SystemSettings' "Textgröße"). */
export function ContentFontSizeConfigPanel({
  config,
  onChange,
}: {
  config: ContentFontSizeConfig
  onChange: (next: ContentFontSizeConfig) => void
}) {
  return (
    <SizeRatioSlider
      label="Textgröße"
      ratio={config.sizeRatio ?? DEFAULT_SIZE_RATIO}
      onChange={(sizeRatio) => onChange({ ...config, sizeRatio })}
    />
  )
}
