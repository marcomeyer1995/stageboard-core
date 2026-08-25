import { ClockControlWidget } from '../widgets/ClockControlWidget'
import { MidiStatusWidget } from '../widgets/MidiStatusWidget'
import { NextSongWidget } from '../widgets/NextSongWidget'
import { PrompterWidget } from '../widgets/PrompterWidget'

export function Dashboard() {
  return (
    <div className="grid h-screen grid-rows-[auto_1fr] gap-3 bg-stage p-3">
      <div className="flex gap-3">
        <div className="flex-1">
          <NextSongWidget />
        </div>
        <ClockControlWidget />
        <MidiStatusWidget />
      </div>
      <PrompterWidget />
    </div>
  )
}
