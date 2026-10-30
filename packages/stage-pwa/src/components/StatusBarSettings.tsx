import { useState } from 'react'
import { useStatusBarPrefsStore } from '../store/useStatusBarPrefsStore'
import { Button, Dialog, IconButton, Switch, InfoHint } from './ui'
import { useTranslation } from 'react-i18next'

/**
 * The status bar's ranking on this device (Marco, 2026-10-07): what matters most stays longest.
 * Top = most important; when room runs out the bar gives items up from the bottom. A switch
 * hides an item for good.
 */
export function StatusBarSettings() {
  const { t } = useTranslation('system')
  const order = useStatusBarPrefsStore((state) => state.order)
  const hidden = useStatusBarPrefsStore((state) => state.hidden)
  const move = useStatusBarPrefsStore((state) => state.move)
  const setShown = useStatusBarPrefsStore((state) => state.setShown)
  const reset = useStatusBarPrefsStore((state) => state.reset)
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1">
        <span className="text-sm font-semibold text-ink-soft">{t('statusBar.order')}</span>
        <InfoHint
          label={t('statusBar.orderExplainLabel')}
          text={t('statusBar.orderExplain')}
        />
      </div>
      <ol className="flex flex-col gap-2" aria-label={t('statusBar.orderList')}>
        {order.map((item, index) => (
          <li key={item} className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <Switch label={t(`statusBar.items.${item}`)} checked={!hidden.includes(item)} onChange={(on) => setShown(item, on)} />
            </div>
            <IconButton icon="up" label={t('statusBar.moreImportant', { item: t(`statusBar.items.${item}`) })} disabled={index === 0} onClick={() => move(item, -1)} />
            <IconButton icon="down" label={t('statusBar.lessImportant', { item: t(`statusBar.items.${item}`) })} disabled={index === order.length - 1} onClick={() => move(item, 1)} />
          </li>
        ))}
      </ol>
      <Button variant="quiet" onClick={reset} className="self-start">
        {t('statusBar.reset')}
      </Button>
    </div>
  )
}

/**
 * In System → Dieses Gerät only a summary and "Anpassen…" (Marco, 2026-10-16: the ranked list with
 * its switches and arrows made the page heavy) - the list itself opens in a dialog.
 */
export function StatusBarSettingsEntry() {
  const { t } = useTranslation('system')
  const order = useStatusBarPrefsStore((state) => state.order)
  const hidden = useStatusBarPrefsStore((state) => state.hidden)
  const [open, setOpen] = useState(false)
  const shown = order.filter((item) => !hidden.includes(item))
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="min-w-0 flex-1 text-sm text-ink-muted">
        {shown.length === order.length ? t('statusBar.allOn') : t('statusBar.someOn', { shown: shown.length, total: order.length })} -{' '}
        {t('statusBar.first', { items: shown.slice(0, 3).map((item) => t(`statusBar.items.${item}`)).join(', ') || '-' })}
      </p>
      <Button onClick={() => setOpen(true)}>{t('statusBar.adjust')}</Button>
      {open && (
        <Dialog title={t('statusBar.title')} onClose={() => setOpen(false)}>
          <StatusBarSettings />
        </Dialog>
      )}
    </div>
  )
}
