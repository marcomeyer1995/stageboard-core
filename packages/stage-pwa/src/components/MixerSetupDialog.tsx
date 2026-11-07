import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MIXER_LIMITS, mixerSetupOf, type MixerSetup, type StageEquipment } from 'shared-types'
import { Button, Dialog, Stepper, Switch } from './ui'

/**
 * "Mischpult einrichten" (Marco, 2026-11-07): the admin sets up a mixer that no plugin knows, as
 * precisely as the desk is - combo and XLR inputs counted apart (the Ui24R: 10 and 10), several
 * headphone outs, USB channels to and from the desk counted apart. Saved on this mixer only; what no
 * longer fits (a cable on input 20 of now 16) is dropped by the caller after a confirm.
 */
export function MixerSetupDialog({ mixer, onSave, onClose }: { mixer: StageEquipment; onSave: (setup: MixerSetup) => void; onClose: () => void }) {
  const { t } = useTranslation('hardware')
  const [s, setS] = useState<MixerSetup>(() => mixerSetupOf(mixer.ports))
  const set = <K extends keyof MixerSetup>(key: K) => (value: MixerSetup[K]) => setS((prev) => ({ ...prev, [key]: value }))
  const count = (key: 'comboInputs' | 'xlrInputs' | 'stereoInputs' | 'auxes' | 'groups' | 'matrices' | 'headphones' | 'usbIn' | 'usbOut' | 'digitalChannels', max: number, info?: string) => (
    <Stepper label={t(`mixer.${key}`)} info={info} unit="" value={s[key]} min={0} max={max} onChange={set(key)} />
  )
  return (
    <Dialog
      title={t('mixer.title', { name: mixer.name })}
      onClose={onClose}
      closeOnBackdrop={false}
      actions={
        <>
          <Button variant="quiet" onClick={onClose}>
            {t('map.cancel')}
          </Button>
          <Button variant="primary" onClick={() => onSave(s)}>
            {t('map.save')}
          </Button>
        </>
      }
    >
      <h3 className="text-base font-bold text-ink">{t('mixer.inputs')}</h3>
      {count('comboInputs', MIXER_LIMITS.inputs)}
      {count('xlrInputs', MIXER_LIMITS.inputs, t('mixer.numbering'))}
      {count('stereoInputs', MIXER_LIMITS.stereo)}

      <h3 className="text-base font-bold text-ink">{t('mixer.outputs')}</h3>
      <p className="text-base text-ink-muted">{t('mixer.main')}</p>
      {count('auxes', MIXER_LIMITS.sends)}
      {count('groups', MIXER_LIMITS.sends)}
      {count('matrices', MIXER_LIMITS.sends)}
      {count('headphones', MIXER_LIMITS.headphones)}

      <h3 className="text-base font-bold text-ink">{t('mixer.digital')}</h3>
      {count('usbIn', MIXER_LIMITS.usb, t('mixer.usbInfo'))}
      {count('usbOut', MIXER_LIMITS.usb)}
      {count('digitalChannels', MIXER_LIMITS.digital)}
      <Switch label={t('mixer.usbStick')} checked={s.usbStick} onChange={set('usbStick')} />

      <h3 className="text-base font-bold text-ink">{t('mixer.control')}</h3>
      <Switch label={t('mixer.network')} checked={s.network} onChange={set('network')} />
      <Switch label={t('mixer.midi')} checked={s.midiDin} onChange={set('midiDin')} />
    </Dialog>
  )
}
