import PouchDB from 'pouchdb-core'
import HttpAdapter from 'pouchdb-adapter-http'
PouchDB.plugin(HttpAdapter)
import { readFileSync } from 'node:fs'
const [host, band, credsFile, cmd] = process.argv.slice(2)
const c = JSON.parse(readFileSync(credsFile, 'utf8'))
const db = new PouchDB(`${host}/db/stageboard-${band}`, { auth: { username: c.username, password: c.password }, fetch: (i, o) => globalThis.fetch(i, o) })
if (cmd === 'prep') {
  await db.put({ _id: 'profiles:ben', id: 'ben', name: 'Ben (Test)', stageRoles: [] }).catch((e) => console.log('profile', e.message))
  await db.put({ _id: 'plugins:youtube-download', id: 'youtube-download', name: 'YouTube', version: '1.0.0', runtime: 'host', capabilities: ['video-download'], transports: [], hardwareIds: [], enabled: true, installedAt: Date.now() }).catch((e) => console.log('plugin', e.message))
  await db.put({ _id: 'song-variants:v1', id: 'v1', songId: 's1', name: 'Original', tracks: [], updatedAt: Date.now() }).catch((e) => console.log('variant', e.message))
  const code = await (await fetch(`${host}/workspaces/${band}/access-code`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ adminUsername: c.username, adminPassword: c.password }) })).json()
  const m = await fetch(`${host}/workspaces/${band}/members`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ adminUsername: c.username, adminPassword: c.password, profileId: 'ben' }) })
  console.log('code', code.code, 'member', m.status)
} else if (cmd === 'queue') {
  const url = process.argv[6]
  const id = 'job-' + Date.now().toString(36)
  await db.put({ _id: `async-jobs:${id}`, id, type: 'audio-import', status: 'queued', progress: 0, createdAt: Date.now(), updatedAt: Date.now(), variantId: 'v1', addonId: 'youtube-download', method: 'fetchAudio', args: { url }, label: 'Tablet-Host-Test' })
  const t0 = Date.now()
  for (;;) {
    const j = await db.get(`async-jobs:${id}`)
    if (j.status === 'done' || j.status === 'error' || Date.now() - t0 > 150000) { console.log('job', j.status, j.runner, j.error ?? '', j.trackId ?? '', Math.round((Date.now() - t0) / 1000) + ' s'); break }
    process.stdout.write(`${j.status}${j.runner ? ' ' + j.runner : ''} ${Math.round((j.progress ?? 0) * 100)}%  `)
    await new Promise((r) => setTimeout(r, 2000))
  }
}
process.exit(0)
