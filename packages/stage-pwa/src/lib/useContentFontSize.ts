import { useContentFontSizeStore } from '../store/useContentFontSizeStore'
import { DEFAULT_SIZE_RATIO, type ContentFontSizeConfig } from '../widgets/contentFontSizeConfig'

/** The device's global default (SystemSettings' "Textgröße", useContentFontSizeStore.ts),
 * scaled by this instance's own ratio if set (ContentFontSizeConfigPanel). */
export function useContentFontSize(config: ContentFontSizeConfig): number {
  const baseFontSize = useContentFontSizeStore((state) => state.baseFontSize)
  return baseFontSize * (config.sizeRatio ?? DEFAULT_SIZE_RATIO)
}
