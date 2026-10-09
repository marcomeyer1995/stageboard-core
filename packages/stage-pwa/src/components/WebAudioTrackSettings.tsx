import { useState } from 'react'
import { setWebAudioTrackEnabled, webAudioTrackEnabled } from '../lib/webAudioTrackEngine'
import { Switch } from './ui'

/** Per device, prototype (#468): the Gig backing track on the click's Web Audio clock. */
export function WebAudioTrackSettings() {
  const [on, setOn] = useState(webAudioTrackEnabled)
  return (
    <Switch
      label="Backing-Track über Web Audio (Test)"
      description="Gig: Track und Klick auf derselben Audio-Uhr, Start auf die Probe genau. Der Track wird vorher in den Speicher entpackt (ca. 1-2 s je Song). Wirkt beim nächsten Song."
      checked={on}
      onChange={(next) => {
        setWebAudioTrackEnabled(next)
        setOn(next)
      }}
    />
  )
}
