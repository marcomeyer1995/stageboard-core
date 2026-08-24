import { useEffect, useState } from 'react'
import { Dashboard } from './components/Dashboard'
import { SheetEditor } from './components/SheetEditor'
import { useSongsStore } from './store/useSongsStore'

function App() {
  const [mode, setMode] = useState<'live' | 'edit'>('live')
  const init = useSongsStore((state) => state.init)

  useEffect(() => {
    init()
  }, [init])

  return (
    <div className="relative h-screen">
      {mode === 'live' ? <Dashboard /> : <SheetEditor />}
      <button
        type="button"
        onClick={() => setMode(mode === 'live' ? 'edit' : 'live')}
        className="absolute bottom-3 right-3 z-10 rounded bg-neutral-800 px-3 py-1 text-xs text-neutral-300 hover:bg-neutral-700"
      >
        {mode === 'live' ? 'Edit Mode' : 'Live Mode'}
      </button>
    </div>
  )
}

export default App
