import { useState } from 'react'
import type { Switch } from '../lib/switches'
import { switchUsage } from '../lib/switchUsage'
import { useDashboardsStore } from '../store/useDashboardsStore'
import { useKeybindingsStore } from '../store/useKeybindingsStore'
import { useLogicalDevicesStore } from '../store/useLogicalDevicesStore'
import { useMidiControllerRulesStore } from '../store/useMidiControllerRulesStore'
import { useSwitchesStore } from '../store/useSwitchesStore'
import { WIDGET_COLOR_SOLID } from '../widgets/widgetColors'
import { useDescribeBehavior } from './BehaviorEditor'
import { SwitchDialog } from './SwitchEditor'
import { AddRow, Badge, InfoHint } from './ui'
import { useTranslation } from 'react-i18next'


/**
 * The band's switches (docs/23 §11.4): each with its behaviour, its state and everything that
 * triggers it. Tapping one edits it - for all its triggers at once.
 */
export function SwitchOverview() {
  const { t } = useTranslation('actions')
  const switches = useSwitchesStore((state) => state.switches)
  const states = useSwitchesStore((state) => state.states)
  const bindings = useKeybindingsStore((state) => state.bindings)
  const midiDocs = useMidiControllerRulesStore((state) => state.docs)
  const devices = useLogicalDevicesStore((state) => state.devices)
  const dashboards = useDashboardsStore((state) => state.dashboards)
  const describe = useDescribeBehavior()
  const [editing, setEditing] = useState<Switch | 'new' | null>(null)

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-1">
        <h2 className="text-sm font-bold uppercase tracking-widest text-ink-faint">{t('switchesTitle')}</h2>
        <InfoHint
          label={t('switchesExplainLabel')}
          text={t('switchesExplain')}
        />
      </div>
      {switches.length === 0 && <p className="text-base text-ink-soft">{t('noSwitch')}</p>}
      {switches.map((sw) => {
        const usage = switchUsage(sw.id, { bindings, midiDocs, devices, dashboards })
        const state = states[sw.id] ?? 'off'
        return (
          <button
            key={sw.id}
            type="button"
            onClick={() => setEditing(sw)}
            className="flex w-full items-center gap-3 rounded-control border border-line bg-surface px-3 py-2 text-left [@media(hover:hover)]:hover:bg-control-hover"
          >
            <span aria-hidden className={`h-4 w-4 flex-shrink-0 rounded-sb-pill ${WIDGET_COLOR_SOLID[sw.color]}`} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="font-semibold text-ink">{sw.name}</span>
              <span className="break-words text-sm text-ink-muted">{describe(sw.behavior)}</span>
              <span className="break-words text-sm text-ink-faint">{usage.length > 0 ? t('triggeredBy', { list: usage.join(', ') }) : t('notTriggered')}</span>
            </span>
            <Badge tone={state === 'off' ? undefined : 'accent'}>{t(`switchState.${state}`)}</Badge>
          </button>
        )
      })}
      <AddRow label={t('newSwitch')} onClick={() => setEditing('new')} />
      {editing && <SwitchDialog initial={editing === 'new' ? null : editing} onSaved={() => setEditing(null)} onClose={() => setEditing(null)} />}
    </section>
  )
}
