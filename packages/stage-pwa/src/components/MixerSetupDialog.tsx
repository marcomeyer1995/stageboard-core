import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MIXER_LIMITS, mixerSetupOf, type MixerSetup, type StageEquipment } from 'shared-types'
import { Button, Dialog, Segmented, Stepper, Switch } from './ui'

/**
 * "Mischpult einrichten" (Marco, 2026-11-07): the admin sets up a mixer that no plugin knows -
 * inputs, sends, USB audio, network, MIDI, digital links. Saved on this mixer only; what no longer
 * fits (a cable on input 20 of now 16) is dropped by the caller after a confirm.
 */
export function MixerSetupDialog({ mixer, onSave, onClose }: { mixer: StageEquipment; onSave: (setup: MixerSetup) => void; onClose: () => void }) {
  const { t } = useTranslation('hardware')
  const [s, setS] = useState<MixerSetup>(() => mixerSetupOf(mixer.ports))
  const set = <K extends keyof MixerSetup>(key: K) => (value: MixerSetup[K]) => setS((prev) => ({ ...prev, [key]: value }))
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
      <Stepper label={t('mixer.mono')} unit="" value={s.monoInputs} min={0} max={MIXER_LIMITS.inputs} onChange={set('monoInputs')} />
      <Segmented
        label={t('mixer.monoConnector')}
        value={s.monoConnector}
        onChange={set('monoConnector')}
        options={[
          { value: 'xlr-jack', label: t('mixer.combo') },
          { value: 'xlr', label: 'XLR' },
        ]}
      />
      <Stepper label={t('mixer.stereo')} unit="" value={s.stereoInputs} min={0} max={MIXER_LIMITS.stereo} onChange={set('stereoInputs')} />

      <h3 className="text-base font-bold text-ink">{t('mixer.outputs')}</h3>
      <p className="text-base text-ink-muted">{t('mixer.main')}</p>
      <Stepper label={t('mixer.auxes')} unit="" value={s.auxes} min={0} max={MIXER_LIMITS.sends} onChange={set('auxes')} />
      <Stepper label={t('mixer.groups')} unit="" value={s.groups} min={0} max={MIXER_LIMITS.sends} onChange={set('groups')} />
      <Stepper label={t('mixer.matrices')} unit="" value={s.matrices} min={0} max={MIXER_LIMITS.sends} onChange={set('matrices')} />
      <Switch label={t('mixer.headphones')} checked={s.headphones} onChange={set('headphones')} />

      <h3 className="text-base font-bold text-ink">{t('mixer.digital')}</h3>
      <Stepper label={t('mixer.usb')} info={t('mixer.usbInfo')} unit="" value={s.usbChannels} min={0} max={MIXER_LIMITS.usb} onChange={set('usbChannels')} />
      <Stepper label={t('mixer.dante')} unit="" value={s.digitalChannels} min={0} max={MIXER_LIMITS.digital} onChange={set('digitalChannels')} />
      <Switch label={t('mixer.usbStick')} checked={s.usbStick} onChange={set('usbStick')} />

      <h3 className="text-base font-bold text-ink">{t('mixer.control')}</h3>
      <Switch label={t('mixer.network')} checked={s.network} onChange={set('network')} />
      <Switch label={t('mixer.midi')} checked={s.midiDin} onChange={set('midiDin')} />
    </Dialog>
  )
}
