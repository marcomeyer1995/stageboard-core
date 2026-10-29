import type { RigCheckPathScore } from 'shared-types'
import { useTranslation } from 'react-i18next'
import type { AnalysisCheck } from '../lib/rigCheckAnalysis'

const pct = (n: number) => `${Math.round(n * 100)} %`

/** One path: tempo it found, points it set, and per section how close the click is to the drums. */
function PathResult({ title, score }: { title: string; score: RigCheckPathScore | null }) {
  const { t } = useTranslation('rigcheck')
  return (
    <div className="flex flex-col gap-1">
      <h4 className="text-base font-semibold text-ink">{title}</h4>
      {!score ? (
        <p className="text-sm text-danger">{t('analysis.nothing')}</p>
      ) : (
        <>
          <p className="text-sm text-ink-soft">
            {t('analysis.tempo', { bpm: score.bpm ?? '?', count: score.gridPoints })}
          </p>
          <ul className="flex flex-col">
            {score.sections.map((s) => (
              // The section's name on its own line where the row is narrow - beside the figures it
              // broke mid-name ("Gleichmäßig / 90") on a phone (2026-10-29); in one row from sm up.
              <li key={s.name} className="flex flex-col gap-x-3 border-b border-line py-1.5 text-sm last:border-b-0 sm:flex-row sm:items-baseline">
                <span className="text-ink sm:w-48 sm:shrink-0">{s.label}</span>
                <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3">
                  {s.knownLimit === 'silent' ? (
                    <span className="text-ink-faint">{t('analysis.rest')}</span>
                  ) : (
                    <>
                      <span className={s.hitRate >= 0.9 ? 'text-ink' : 'text-warn'}>{t('analysis.hits', { percent: pct(s.hitRate) })}</span>
                      <span className="text-ink-soft">
                        {t('analysis.distance', { mean: Math.round(s.meanAbsMs), max: Math.round(s.maxAbsMs) })}
                      </span>
                      {s.slipRate > 0.1 && <span className="font-semibold text-danger">{t('analysis.slipped', { percent: pct(s.slipRate) })}</span>}
                      {s.knownLimit === 'change-in-bar' && <span className="text-ink-faint">{t('analysis.knownLimit')}</span>}
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

/**
 * The analysis check against the Rig-Check's ground truth (#464, docs/24 §6): for each of the
 * editor's two analysis paths, per section of the full run, whether its click grid lands on the
 * drums and counts the bars right.
 */
export function RigCheckAnalysis({ check }: { check: Pick<AnalysisCheck, 'detect' | 'refine'> }) {
  const { t } = useTranslation('rigcheck')
  return (
    <div className="flex flex-col gap-3">
      <PathResult title={t('analysis.refine')} score={check.refine} />
      <PathResult title={t('analysis.detect')} score={check.detect} />
    </div>
  )
}
