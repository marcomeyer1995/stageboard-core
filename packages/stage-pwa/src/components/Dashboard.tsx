import { NextSongWidget } from '../widgets/NextSongWidget'
import { PrompterWidget } from '../widgets/PrompterWidget'

export function Dashboard() {
  return (
    <div className="grid h-screen grid-rows-[auto_1fr] gap-3 bg-black p-3">
      <NextSongWidget />
      <PrompterWidget />
    </div>
  )
}
