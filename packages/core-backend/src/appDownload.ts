import { existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { HostRoute, HostRouteResponse } from 'sync-host'

/** What scripts/build-android-app.sh writes next to the APK. */
export interface AppVersion {
  versionCode: number
  versionName: string
  builtAt: string
}

/** Where this host keeps the app build: `STAGEBOARD_APP_DIR`, else `<state dir>/app`. */
export const appDir = (): string => process.env.STAGEBOARD_APP_DIR ?? join(process.env.STAGEBOARD_STATE_DIR ?? './data', 'app')

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
    : '<p>Auf diesem Host ist noch keine App gebaut.</p>'
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
 * Serves the native Android app (#348) from the Host itself - no app store, works offline at the venue: `/app` (download page),
 * `/app/stageboard.apk`, `/app/version.json` (the installed app compares its own build number against it and offers the update).
 * A route table of the Node shell (#964, step 2): the same shape as the routes every host shares, so any listener can serve it.
 */
export function appRoutes(dir: string): HostRoute[] {
  const noBuild = (): HostRouteResponse => ({ status: 404, body: { status: 'error', message: 'No app build on this Host' } })
  return [
    { method: 'GET', pattern: '/app', handle: async () => ({ status: 200, binary: { data: new TextEncoder().encode(downloadPage(readAppVersion(dir))), contentType: 'text/html; charset=utf-8' } }) },
    { method: 'GET', pattern: '/app/version.json', handle: async () => readAppVersion(dir) ? { status: 200, body: readAppVersion(dir) } : noBuild() },
    {
      method: 'GET',
      pattern: '/app/stageboard.apk',
      handle: async () => {
        if (!readAppVersion(dir)) return noBuild()
        return {
          status: 200,
          headers: { 'Content-Disposition': 'attachment; filename="stageboard.apk"', 'Cache-Control': 'no-cache' },
          binary: { data: new Uint8Array(await readFile(join(dir, 'stageboard.apk'))), contentType: 'application/vnd.android.package-archive' },
        }
      },
    },
  ]
}
