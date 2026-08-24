import type { ChordProLine } from '../lib/chordpro'

interface ChordProLyricsProps {
  lines: ChordProLine[]
}

export function ChordProLyrics({ lines }: ChordProLyricsProps) {
  if (lines.length === 0) {
    return <p className="text-neutral-500">Kein Text.</p>
  }

  return (
    <div className="space-y-3 pt-4 font-mono text-lg leading-loose text-white">
      {lines.map((line, lineIndex) => (
        <p key={lineIndex} className="whitespace-pre-wrap">
          {line.segments.map((segment, segmentIndex) => (
            <span key={segmentIndex} className="relative inline-block">
              {segment.chord && (
                <span className="absolute -top-4 left-0 text-xs font-bold text-amber-400">
                  {segment.chord}
                </span>
              )}
              {segment.text}
            </span>
          ))}
        </p>
      ))}
    </div>
  )
}
