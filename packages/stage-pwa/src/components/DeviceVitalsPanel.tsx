import i18n from '../i18n'
import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, InfoHint, StatusDot, type Status } from './ui'
import { assessVitals, STALL_MS, useDeviceVitalsStore, vitalsSnapshot, type VitalsSnapshot } from '../lib/deviceVitals'
import { useNativeOutputStore } from '../lib/nativeOutput'

function num(value: number, digits = 0): string {
  return value.toLocaleString(i18n.language, { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

function duration(ms: number): string {
  const min = Math.floor(ms / 60_000)
  return min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`
}

/** Frames per second, counted only while this panel is open - nothing runs per frame otherwise. */
function useFrameRate(): number | null {
  const [fps, setFps] = useState<number | null>(null)
  useEffect(() => {
    let frames = 0
    let from = performance.now()
    let raf = requestAnimationFrame(function tick(now) {
      frames++
      if (now - from >= 1000) {
        setFps(Math.round((frames * 1000) / (now - from)))
        frames = 0
        from = now
      }
      raf = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(raf)
  }, [])
  return fps
}

function Row({ label, status, children }: { label: string; status?: Status; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1">
      <dt className="min-w-[12rem] text-base text-ink-muted">{label}</dt>
      <dd className="flex items-center gap-2 text-base text-ink">
        {status && <StatusDot status={status} />}
        <span>{children}</span>
      </dd>
    </div>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col">
      <h4 className="text-base font-bold text-ink">{title}</h4>
      <dl className="flex flex-col">{children}</dl>
    </div>
  )
}

/**
 * This device's condition at the top of Diagnose (Marco, 2026-11-06): sound, memory, app
 * performance, band clock - each with a light, and the whole as one line on top. Refreshed every
 * 2 s from lib/deviceVitals.ts; the Geräte tab shows the same light per device.
 */
export function DeviceVitalsPanel() {
  const { t } = useTranslation('system')
  const { t: td } = useTranslation('devices')
  const v: VitalsSnapshot = useDeviceVitalsStore((state) => state.snapshot) ?? vitalsSnapshot()
  const fellBack = useNativeOutputStore((state) => state.fellBack)
  const setWanted = useNativeOutputStore((state) => state.setWanted)
  const usb = useNativeOutputStore((state) => state.usb)
  const usbError = useNativeOutputStore((state) => state.usbError)
  const fps = useFrameRate()
  const { level, issues } = assessVitals(v)
  const has = (issue: (typeof issues)[number]): boolean => issues.includes(issue)
  const light = (bad: boolean, warn = false): Status => (bad ? 'error' : warn ? 'warning' : 'ok')

  const audio = v.audio
  const clockPct = v.audioClock?.pct ?? null
  const n = v.native

  return (
    <section className="flex flex-col gap-4 rounded-container border border-line bg-surface p-4" aria-label={t('vit.title')}>
      <div className="flex items-center gap-1">
        <h3 className="text-lg font-bold text-ink">{t('vit.title')}</h3>
        <InfoHint label={t('vit.explainLabel')} text={t('vit.explain')} />
      </div>
      <p role="status" className={`flex items-center gap-2 text-base font-bold ${level === 'error' ? 'text-danger' : level === 'warning' ? 'text-warn' : 'text-ink'}`}>
        <StatusDot status={level === 'ok' ? 'ok' : level} />
        {level === 'ok' ? t('vit.allGood') : issues.map((issue) => td(`vitals.issue.${issue}`)).join(' · ')}
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        <Group title={t('vit.sound')}>
          {audio === null ? (
            <Row label={t('vit.output')}>{t('vit.outputBrowser')}</Row>
          ) : (
            <>
              <Row label={t('vit.output')} status={fellBack ? 'error' : audio.estimated ? 'warning' : undefined}>
                {audio.path === 'native' ? t(audio.estimated ? 'vit.nativeEstimated' : 'vit.native', { ms: audio.delayMs }) : fellBack ? t(fellBack.reason === 'broken' ? 'vit.fellBackBroken' : 'vit.fellBack', { time: new Date(fellBack.at).toLocaleTimeString(i18n.language), ms: num(fellBack.missingMs) }) : t('vit.webview')}
              </Row>
              {audio.path === 'native' && (
                <>
                  <Row label={t('vit.missing')} status={light(false, has('audioMissing'))}>
                    {audio.missingMs > 0 ? `${num(audio.missingMs)} ms` : t('vit.none')}
                  </Row>
                  <Row label={t('vit.reserve')} status={audio.leadMinMs === null ? undefined : light(false, has('audioTight'))}>
                    {audio.leadMinMs === null ? t('vit.settling') : `${num(audio.leadMinMs)} ms`}
                  </Row>
                  {usb ? (
                    // The own USB driver writes to the interface directly: Android's volume keys don't reach it.
                    <Row label={t('vit.volume')}>
                      {t('vit.volumeUsb')}
                    </Row>
                  ) : usbError !== null ? (
                    <Row label={t('vit.usbDriver')} status="warning">
                      {t('vit.usbDriverFailed', { error: usbError })}
                    </Row>
                  ) : null}
                </>
              )}
            </>
          )}
          <Row label={t('vit.audioClock')} status={clockPct === null ? undefined : light(false, has('audioClock'))}>
            {clockPct === null ? t('vit.audioClockWait') : t('vit.audioClockValue', { pct: num(clockPct, 2) })}
            {v.audioClock && v.audioClock.losses > 0 && ` · ${t('vit.losses', { count: v.audioClock.losses, ms: v.audioClock.worstLossMs })}`}
          </Row>
          {fellBack && (
            <div className="pt-1">
              <Button
                onClick={() => {
                  setWanted(false)
                  setWanted(true)
                }}
              >
                {t('vit.retryNative')}
              </Button>
            </div>
          )}
        </Group>

        <Group title={t('vit.memory')}>
          {n ? (
            <>
              <Row label={t('vit.deviceFree')} status={light(has('memoryLow'), has('memoryTight'))}>
                {t('vit.freeOf', { free: num(n.availMb), total: num(n.totalMb / 1024, 1) })}
                {n.lowMemory && ` · ${t('vit.androidLow')}`}
              </Row>
              <Row label={t('vit.appMemory')}>{`${num(n.appMb)} MB`}</Row>
            </>
          ) : (
            <Row label={t('vit.deviceFree')}>{t('vit.onlyApp')}</Row>
          )}
          {v.jsHeapMb !== null && <Row label={t('vit.jsMemory')}>{t('vit.jsOf', { used: num(v.jsHeapMb), limit: num(v.jsHeapLimitMb ?? 0) })}</Row>}
        </Group>

        <Group title={t('vit.performance')}>
          <Row label={t('vit.fps')}>{fps === null ? '…' : t('vit.fpsValue', { fps })}</Row>
          <Row label={t('vit.stalls', { ms: STALL_MS })} status={v.framesWatched ? light(false, has('stalls')) : undefined}>
            {!v.framesWatched ? t('vit.notMeasurable') : v.stallsPerMin > 0 ? t('vit.stallsValue', { count: v.stallsPerMin, ms: v.worstFrameMs }) : t('vit.none')}
          </Row>
          <Row label={t('vit.cpu')}>{n?.cpuPct != null ? t('vit.cpuValue', { pct: n.cpuPct, cores: n.cores }) : t('vit.onlyApp')}</Row>
          <Row label={t('vit.uptime')}>{duration(v.uptimeMs)}</Row>
        </Group>

        <Group title={t('vit.clock')}>
          {v.clock.ageMs === null ? (
            <Row label={t('vit.clockLast')}>{t('vit.clockNone')}</Row>
          ) : (
            <>
              <Row label={t('vit.clockOffset')}>{`${v.clock.offsetMs >= 0 ? '+' : ''}${num(v.clock.offsetMs, 1)} ms`}</Row>
              <Row label={t('vit.clockUncertainty')} status={light(false, has('clockUnsure'))}>
                {v.clock.uncertaintyMs === null ? '…' : `±${num(v.clock.uncertaintyMs, 1)} ms`}
              </Row>
              {v.clock.rttMs !== null && <Row label={t('vit.clockRtt')}>{`${num(v.clock.rttMs)} ms`}</Row>}
              <Row label={t('vit.clockLast')}>{t('vit.ago', { s: Math.round(v.clock.ageMs / 1000) })}</Row>
            </>
          )}
        </Group>
      </div>
    </section>
  )
}
