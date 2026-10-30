import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { MeasureInput, MeasureInputKind, MeasureInputs, MeasureInputsOverview, MeasureLevel } from 'shared-types'
import { playClickAt } from '../lib/clickEngine'
import { getSharedAudioContext } from '../lib/sharedAudioContext'
import { getStageServerUrl } from '../lib/stageServer'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { Group } from './SystemSettings'
import { Button, Section, Select } from './ui'

/** How long "Pegel prüfen" listens; "Testklick" plays its clicks inside that window. */
const LISTEN_MS = 2500
/** The test clicks, after the server's input has settled (micCapture.ts SETTLE_MS = 600). */
const TEST_CLICKS_MS = [1000, 1600, 2200]

const KINDS: MeasureInputKind[] = ['mic', 'cable']

/** The server's measuring-input calls - like the backup settings, only for an admin of the band
 * the server serves (the server checks the login again). */
function useServerCall() {
  const { t } = useTranslation('rigcheck')
  const workspace = useWorkspaceStore((s) => s.workspaces.find((w) => w.id === s.activeWorkspaceId))
  return useCallback(
    async <T,>(path: string, extra: object = {}): Promise<T> => {
      const base = getStageServerUrl()
      if (!base || !workspace?.username || !workspace.couchPassword) throw new Error(t('inputs.noAdmin'))
      const res = await fetch(`${base}/server/measure-inputs/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminUsername: workspace.username, adminPassword: workspace.couchPassword, ...extra }),
      })
      const body = (await res.json().catch(() => null)) as (T & { message?: string }) | null
      if (!res.ok) throw new Error(body?.message ?? t('inputs.http', { status: res.status }))
      return body as T
    },
    [workspace?.username, workspace?.couchPassword, t],
  )
}

/** One measuring input: device and channel, and a quick look whether anything arrives. */
function InputRow({ kind, overview, onChange }: { kind: MeasureInputKind; overview: MeasureInputsOverview; onChange: (input: MeasureInput | null) => void }) {
  const { t } = useTranslation('rigcheck')
  const call = useServerCall()
  const selected = overview.selected[kind]
  const [result, setResult] = useState<string | null>(null)
  const [listening, setListening] = useState(false)
  const known = overview.inputs.find((input) => input.device === selected?.device)
  // What the server falls back to (MeasureInputStore.resolve): an unset cable listens like the microphone.
  const listenOn: MeasureInput = selected ?? overview.selected.mic ?? { device: overview.fallbackMic, channel: 0 }
  const channels = Math.max(known?.channels ?? 2, (selected?.channel ?? 0) + 1)

  const deviceOptions = [
    { value: '', label: kind === 'mic' ? t('inputs.micDefault', { device: overview.fallbackMic }) : t('inputs.cableDefault') },
    ...overview.inputs.map((input) => ({ value: input.device, label: input.name })),
    // A chosen interface that is unplugged right now stays chosen - and says so.
    ...(selected && !known ? [{ value: selected.device, label: t('inputs.missing', { device: selected.device }) }] : []),
  ]

  const listen = async (withClicks: boolean) => {
    setListening(true)
    setResult(null)
    try {
      if (withClicks) {
        // The clicks from this device, timed into the window the server listens in.
        const ctx = getSharedAudioContext()
        await ctx.resume().catch(() => {})
        const start = ctx.currentTime
        for (const at of TEST_CLICKS_MS) playClickAt(ctx, start + at / 1000, true)
      }
      const level = await call<MeasureLevel>('level', { input: listenOn, durationMs: LISTEN_MS })
      if (level.error) setResult(t('inputs.failed', { message: level.error }))
      else {
        const loud = level.peakDb === null ? t('inputs.silent') : t('inputs.levelResult', { db: level.peakDb })
        const clicks = withClicks ? t('inputs.clicksOf', { count: level.clicks, of: TEST_CLICKS_MS.length }) : t('inputs.clicks', { count: level.clicks })
        setResult(`${loud} · ${clicks}`)
      }
    } catch (err) {
      setResult(t('inputs.failed', { message: err instanceof Error ? err.message : String(err) }))
    } finally {
      setListening(false)
    }
  }

  return (
    <Section title={t(`inputs.${kind}`)}>
      <div className="grid grid-cols-1 gap-2 min-[600px]:grid-cols-[1fr_10rem]">
        <Select
          label={t('inputs.device')}
          value={selected?.device ?? ''}
          options={deviceOptions}
          onChange={(e) => onChange(e.target.value ? { device: e.target.value, channel: 0 } : null)}
        />
        <Select
          label={t('inputs.channel')}
          value={String(selected?.channel ?? 0)}
          disabled={!selected}
          options={Array.from({ length: channels }, (_, n) => ({ value: String(n), label: t('inputs.channelN', { n: n + 1 }) }))}
          onChange={(e) => selected && onChange({ ...selected, channel: Number(e.target.value) })}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={listening} onClick={() => void listen(false)}>
          {t('inputs.level')}
        </Button>
        <Button disabled={listening} onClick={() => void listen(true)}>
          {t('inputs.testClick')}
        </Button>
        <span className="text-sm text-ink-soft" role="status">
          {listening ? t('inputs.listening') : result}
        </span>
      </div>
    </Section>
  )
}

/**
 * System → Rig-Check → Messeingänge (docs/24 §7.2, #662): which of the Stage-Server's audio inputs
 * listens when it measures a device's click - a microphone for speakers, a cable for headphones,
 * in-ear and Bluetooth. Kept by the server (its hardware); only admins see and change it.
 */
export function RigCheckInputs() {
  const { t } = useTranslation('rigcheck')
  const isAdmin = useWorkspaceStore((s) => s.workspaces.find((w) => w.id === s.activeWorkspaceId)?.isAdmin ?? false)
  const call = useServerCall()
  const [overview, setOverview] = useState<MeasureInputsOverview | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isAdmin) return
    call<MeasureInputsOverview>('overview')
      .then((o) => {
        setOverview(o)
        setError(null)
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }, [isAdmin, call])

  const change = (kind: MeasureInputKind, input: MeasureInput | null) => {
    if (!overview) return
    const selected: MeasureInputs = { ...overview.selected, [kind]: input }
    setOverview({ ...overview, selected })
    call('save', { selected }).catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }

  return (
    <Group title={t('inputs.title')} info={t('inputs.info')}>
      {!isAdmin ? (
        <p className="text-sm text-ink-faint">{t('inputs.adminOnly')}</p>
      ) : error ? (
        <p className="text-sm text-danger">{t('inputs.failed', { message: error })}</p>
      ) : !overview ? (
        <p className="text-sm text-ink-faint">{t('inputs.loading')}</p>
      ) : (
        <>
          {overview.inputs.length === 0 && <p className="text-sm text-warn">{t('inputs.none')}</p>}
          {KINDS.map((kind) => (
            <InputRow key={kind} kind={kind} overview={overview} onChange={(input) => change(kind, input)} />
          ))}
        </>
      )}
    </Group>
  )
}
