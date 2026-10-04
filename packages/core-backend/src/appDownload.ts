import { createReadStream, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'

/** What scripts/build-android-app.sh writes next to the APK. */
export interface AppVersion {
  versionCode: number
  versionName: string
  builtAt: string
}

/** The app build in `dir`, or null when none has been built yet. */
export function readAppVersion(dir: string): AppVersion | null {
  const file = join(dir, 'version.json')
  if (!existsSync(file) || !existsSync(join(dir, 'stageboard.apk'))) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as AppVersion
  } catch {
    return null
  }
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

/** The download page a new band member opens on their phone (stage-size: big text, big button). */
export function downloadPage(version: AppVersion | null): string {
  const body = version
    ? `<p>Version ${escapeHtml(version.versionName)}</p>
<a class="button" href="/app/stageboard.apk" download="stageboard.apk">App herunterladen</a>
<ol>
<li>„App herunterladen“ tippen und die Datei öffnen.</li>
<li>Android fragt einmal, ob Apps aus dieser Quelle installiert werden dürfen – erlauben.</li>
<li>Installieren, StageBoard öffnen und den QR-Code der Band scannen.</li>
</ol>`
    : '<p>Auf diesem Stage-Server ist noch keine App gebaut.</p>'
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>StageBoard-App</title>
<style>
body { margin: 0; padding: 24px 16px; background: #000; color: #e5e5e5; font: 18px/1.5 system-ui, sans-serif; }
main { max-width: 32rem; margin: 0 auto; }
h1 { font-size: 28px; }
.button { display: flex; align-items: center; justify-content: center; min-height: 64px; margin: 24px 0; border-radius: 12px; background: #f59e0b; color: #000; font-weight: 800; font-size: 20px; text-decoration: none; }
li { margin: 8px 0; }
</style>
</head>
<body><main>
<h1>StageBoard für Android</h1>
${body}
</main></body>
</html>
`
}

/**
 * Serves the native Android app (#348) from the Stage-Server itself - no app store, works offline
 * at the venue: `/app` (download page), `/app/stageboard.apk`, `/app/version.json` (the installed
 * app compares its own build number against it and offers the update).
 */
export function registerAppRoutes(app: FastifyInstance, dir: string): void {
  app.get('/app', async (_request, reply) => reply.type('text/html; charset=utf-8').send(downloadPage(readAppVersion(dir))))

  app.get('/app/version.json', async (_request, reply) => {
    const version = readAppVersion(dir)
    if (!version) return reply.status(404).send({ status: 'error', message: 'No app build on this Stage-Server' })
    return version
  })

  app.get('/app/stageboard.apk', async (_request, reply) => {
    if (!readAppVersion(dir)) return reply.status(404).send({ status: 'error', message: 'No app build on this Stage-Server' })
    return reply
      .type('application/vnd.android.package-archive')
      .header('Content-Disposition', 'attachment; filename="stageboard.apk"')
      .header('Cache-Control', 'no-cache')
      .send(createReadStream(join(dir, 'stageboard.apk')))
  })
}
