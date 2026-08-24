import { useShowStore } from '../store/useShowStore'

export function PrompterWidget() {
  const currentSong = useShowStore((state) => state.currentSong)

  return (
    <div className="flex h-full flex-col items-center justify-center rounded-lg bg-neutral-900 p-8 text-center">
      <p className="text-sm uppercase tracking-widest text-neutral-500">Now Playing</p>
      <h1 className="mt-2 text-5xl font-bold text-white">{currentSong.title}</h1>
    </div>
  )
}
