import { useState } from 'react'
import { setWebAudioTrackEnabled, webAudioTrackEnabled } from '../lib/webAudioTrackEngine'
import { Switch } from './ui'

/** Per device (#468, on by default since 2026-10-15): the Gig backing track on the click's Web Audio clock. */
export function WebAudioTrackSettings() {
  const [on, setOn] = useState(webAudioTrackEnabled)
  return (
    <Switch
      label="Backing-Track über Web Audio"
      description="Gig: Track und Klick auf derselben Audio-Uhr, Start auf die Probe genau, klingt wie beim Üben. Aus: über den Audio-Player des Systems (auf manchen Geräten mit Klangeffekten wie Dolby). Wirkt beim nächsten Song."
      checked={on}
      onChange={(next) => {
        setWebAudioTrackEnabled(next)
        setOn(next)
      }}
    />
  )
}
