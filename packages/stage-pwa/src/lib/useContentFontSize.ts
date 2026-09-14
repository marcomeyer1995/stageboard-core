import { useContentFontSizeStore } from '../store/useContentFontSizeStore'
import type { ContentFontSizeConfig } from '../widgets/contentFontSizeConfig'

/** This instance's own override if set (ContentFontSizeConfigPanel), else the device's
 * global default (SystemSettings' "Textgröße", useContentFontSizeStore.ts). */
export function useContentFontSize(config: ContentFontSizeConfig): number {
  const baseFontSize = useContentFontSizeStore((state) => state.baseFontSize)
  return config.fontSize ?? baseFontSize
}
