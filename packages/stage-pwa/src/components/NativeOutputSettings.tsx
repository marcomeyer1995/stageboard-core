import { nativeOutputAvailable, useNativeOutputStore } from '../lib/nativeOutput'
import { Switch } from './ui'
import { useTranslation } from 'react-i18next'

/** Per device, Android app only (docs/30): play this device's audio through its native output at
 * a delay of our own instead of the WebView's speaker - then no stored latency is needed. Sits in
 * this device's "Latenz…" dialog above the compensation it replaces. */
export function NativeOutputSettings() {
  const { t } = useTranslation('devices')
  const wanted = useNativeOutputStore((state) => state.wanted)
  const setWanted = useNativeOutputStore((state) => state.setWanted)
  const state = useNativeOutputStore((state) => state.state)
  const delayMs = useNativeOutputStore((state) => state.delayMs)
  const error = useNativeOutputStore((state) => state.error)
  if (!nativeOutputAvailable()) return null
  const status =
    state === 'on' ? t('native.on', { ms: delayMs }) : state === 'starting' ? t('native.starting') : state === 'failed' ? t('native.failed', { error }) : t('native.off')
  return <Switch label={t('native.label')} description={status} info={t('native.info')} checked={wanted} onChange={setWanted} />
}
