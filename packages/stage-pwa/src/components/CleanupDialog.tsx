import { useMemo, useState } from 'react'
import { applyCleanupRules, CLEANUP_RULES, cleanupCounts, loadCleanupSelection, saveCleanupSelection, type CleanupRuleId } from '../lib/cleanupRules'
import { Button, CheckRow, Dialog, InfoHint } from './ui'
import { useTranslation } from 'react-i18next'

/**
 * "Aufräumen" with its rules to tick (Marco, 2026-10-29): each rule with how many places it would
 * change in `text` (the selected lines or the whole text) and an ⓘ with an example. The ticked
 * rules are remembered on this device.
 */
export function CleanupDialog({ text, scope, onApply, onCancel }: { text: string; scope: string; onApply: (after: string) => void; onCancel: () => void }) {
  const { t } = useTranslation('editor')
  const [enabled, setEnabled] = useState<CleanupRuleId[]>(loadCleanupSelection)
  const counts = useMemo(() => cleanupCounts(text, enabled), [text, enabled])
  const total = CLEANUP_RULES.reduce((sum, rule) => sum + (enabled.includes(rule.id) ? counts[rule.id] : 0), 0)
  const toggle = (id: CleanupRuleId) => setEnabled((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]))

  return (
    <Dialog
      title={t('cleanup.title')}
      size="l"
      onClose={onCancel}
      actions={
        <>
          <Button onClick={onCancel}>{t('cancel')}</Button>
          <Button
            variant="primary"
            disabled={total === 0}
            onClick={() => {
              saveCleanupSelection(enabled)
              onApply(applyCleanupRules(text, enabled))
            }}
          >
            {total === 0 ? t('cleanup.nothing') : t('cleanup.apply', { count: total })}
          </Button>
        </>
      }
    >
      <p className="text-base text-ink-soft">{t('cleanup.scope', { scope })}</p>
      <div className="flex flex-col gap-2">
        {CLEANUP_RULES.map((rule) => (
          <div key={rule.id} className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <CheckRow checked={enabled.includes(rule.id)} onToggle={() => toggle(rule.id)}>
                {t(`cleanup.rule.${rule.id}`)}
              </CheckRow>
            </div>
            {/* Beside the row, never cut off with a long name: how many places. */}
            <span aria-label={t('cleanup.places', { count: counts[rule.id] })} className={`w-8 flex-shrink-0 text-right text-base tabular-nums ${counts[rule.id] > 0 ? 'text-ink' : 'text-ink-faint'}`}>
              {counts[rule.id]}
            </span>
            <InfoHint text={t(`cleanup.hint.${rule.id}`)} />
          </div>
        ))}
      </div>
    </Dialog>
  )
}
