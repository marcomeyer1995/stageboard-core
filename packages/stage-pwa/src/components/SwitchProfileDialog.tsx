import { useState } from 'react'
import type { Profile } from 'shared-types'
import { useActiveProfile } from '../lib/useActiveProfile'
import { useActiveProfileStore } from '../store/useActiveProfileStore'
import { useAppModeStore } from '../store/useAppModeStore'
import { useDialogStore } from '../store/useDialogStore'
import { useProfilesStore } from '../store/useProfilesStore'
import { useShowStateStore } from '../store/useShowStateStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { Button, Dialog, choiceRow } from './ui'
import { INPUT_FREE } from './ui/styles'
import { useTranslation } from 'react-i18next'

/**
 * "Ich bin …" from the ☰ drawer (Marco, 2026-10-16): who uses this device, within the same band -
 * without going to System → Band. Same rules as there: a local-only band switches right away, a
 * member too, an admin asks for its 4-digit PIN. Only in the drawer, never on the status bar - a
 * stray tap there mid-song is too risky.
 */
export function SwitchProfileDialog({ onClose }: { onClose: () => void }) {
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)
  const workspace = useWorkspaceStore((state) => state.workspaces.find((w) => w.id === state.activeWorkspaceId))
  const activateProfile = useWorkspaceStore((state) => state.activateProfile)
  const profiles = useProfilesStore((state) => state.profiles)
  const setActiveProfile = useActiveProfileStore((state) => state.setActive)
  const me = useActiveProfile()
  const isMaster = useShowStateStore((state) => state.isMaster)
  const sessionMode = useAppModeStore((state) => state.mode)
  const confirm = useDialogStore((state) => state.confirm)
  const { t } = useTranslation(['menu', 'common'])
  const [askingPinFor, setAskingPinFor] = useState<Profile | null>(null)
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)

  async function activate(profile: Profile, password: string | undefined) {
    setBusy(true)
    const done = await activateProfile(workspaceId, profile.id, password)
    setBusy(false)
    if (!done) return
    setActiveProfile(workspaceId, profile.id)
    onClose()
  }

  async function pick(profile: Profile) {
    if (profile.id === me?.id) return onClose()
    // "Master pro Person": master belongs to the person, so this device stops controlling the show.
    if (sessionMode === 'gig' && isMaster && workspace?.masterMode === 'account') {
      const ok = await confirm(t('menu:profile.masterConfirm', { name: profile.name }), {
        title: t('menu:profile.masterConfirmTitle'),
        confirmLabel: t('menu:profile.switchAnyway'),
      })
      if (!ok) return
    }
    if (!workspace?.username) {
      setActiveProfile(workspaceId, profile.id)
      return onClose()
    }
    if (!profile.stageRoles.includes('admin')) return void activate(profile, undefined)
    setAskingPinFor(profile)
    setPin('')
  }

  return (
    <Dialog title={t('menu:profile.title')} size="s" closeLabel={t('common:actions.cancel')} onClose={onClose}>
      {askingPinFor ? (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (pin.length === 4) void activate(askingPinFor, pin)
          }}
          className="flex flex-col gap-3"
        >
          <p className="text-base text-ink-soft">{t('menu:profile.pinOf', { name: askingPinFor.name })}</p>
          <div className="flex gap-2">
            <input
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder={t('menu:profile.pinPlaceholder')}
              inputMode="numeric"
              aria-label={t('menu:profile.pinOf', { name: askingPinFor.name })}
              autoFocus
              className={`h-form flex-1 min-w-0 px-3 text-center text-lg tracking-widest ${INPUT_FREE}`}
            />
            <Button variant="primary" type="submit" disabled={busy || pin.length !== 4}>
              {busy ? '…' : t('menu:profile.switch')}
            </Button>
          </div>
          <Button onClick={() => setAskingPinFor(null)}>{t('common:actions.back')}</Button>
        </form>
      ) : (
        <div className="flex flex-col gap-2" role="group" aria-label={t('menu:profile.members')}>
          {profiles.map((profile) => (
            <button
              key={profile.id}
              type="button"
              aria-current={profile.id === me?.id ? 'true' : undefined}
              disabled={busy}
              onClick={() => void pick(profile)}
              className={choiceRow(profile.id === me?.id)}
            >
              {profile.name}
            </button>
          ))}
        </div>
      )}
    </Dialog>
  )
}
