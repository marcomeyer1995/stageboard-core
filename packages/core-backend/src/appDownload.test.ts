import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import { downloadPage, registerAppRoutes } from './appDownload.js'

function server(withBuild: boolean) {
  const dir = mkdtempSync(join(tmpdir(), 'app-'))
  if (withBuild) {
    writeFileSync(join(dir, 'stageboard.apk'), 'APK')
    writeFileSync(join(dir, 'version.json'), JSON.stringify({ versionCode: 420, versionName: '1.420 (abc1234)', builtAt: '2026-10-04T08:00:00Z' }))
  }
  const app = Fastify()
  registerAppRoutes(app, dir)
  return app
}

describe('app download (#348)', () => {
  it('serves version, APK and a download page from the build directory', async () => {
    const app = server(true)
    expect((await app.inject('/app/version.json')).json()).toEqual({ versionCode: 420, versionName: '1.420 (abc1234)', builtAt: '2026-10-04T08:00:00Z' })
    const apk = await app.inject('/app/stageboard.apk')
    expect(apk.statusCode).toBe(200)
    expect(apk.headers['content-type']).toBe('application/vnd.android.package-archive')
    expect(apk.body).toBe('APK')
    const page = await app.inject('/app')
    expect(page.body).toContain('Version 1.420 (abc1234)')
    expect(page.body).toContain('href="/app/stageboard.apk"')
  })

  it('answers 404 / a hint while no app has been built', async () => {
    const app = server(false)
    expect((await app.inject('/app/version.json')).statusCode).toBe(404)
    expect((await app.inject('/app/stageboard.apk')).statusCode).toBe(404)
    expect((await app.inject('/app')).body).toContain('noch keine App gebaut')
  })

  it('escapes the version name', () => {
    expect(downloadPage({ versionCode: 1, versionName: '<b>x</b>', builtAt: '' })).toContain('&lt;b&gt;x&lt;/b&gt;')
  })
})
