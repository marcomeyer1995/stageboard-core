import { z } from 'zod'

/**
 * Messages the Stage-Server shows to musicians (#679). The server serves devices in different
 * languages, so it sends a code with its values (`messageCode`, `messageParams`) and the device
 * translates it (stage-pwa `i18n/locales/<language>/server.json`). The German text below goes
 * along as `message`: an older app, a log line or `curl` still reads something sensible.
 *
 * Placeholders are i18next's `{{name}}`, so the same template works on the server and in the app.
 * The app's `de/server.json` must say exactly the same - a test there compares the two.
 *
 * Only for what reaches a screen. Programmer errors ("Missing query parameter q") stay plain
 * English text, and the CLI tools (deleteBand, resetAdmin) stay German - they run in a terminal.
 */
export const SERVER_MESSAGES_DE = {
  'backup.unknownTarget': 'Unbekanntes Ziel',
  'backup.folderMissing': 'Ordner nicht da (nicht eingesteckt oder nicht eingehängt): {{path}}',
  'backup.folderNotWritable': 'Der Stage-Server darf in diesen Ordner nicht schreiben.',
  'backup.sameDisk': 'Der Ordner liegt auf derselben Platte wie die Daten - Medium nicht eingehängt? Ein zweites Medium wählen.',
  'backup.folderOk': 'Ordner ist beschreibbar und liegt auf einem eigenen Medium.',
  'backup.sshKeyMissing': 'SSH-Schlüssel des Servers fehlt.',
  'backup.nasOk': 'Verbunden - {{path}} ist beschreibbar.',
  'backup.nasNoConnection': 'Keine Verbindung zur NAS.',
  'backup.never': 'Noch keine Sicherung gelaufen',
  'backup.statusUnreadable': 'Status-Datei unlesbar',
  'calibration.busy': 'Gerade läuft schon eine Messung - bitte kurz warten.',
  'calibration.unknownRun': 'Unbekannte Messung',
  'band.noneActive': 'Auf diesem Stage-Server ist keine Band aktiv.',
  'band.activeAdminOnly': 'Nur ein Admin der aktiven Band.',
  'device.notConnected': 'Zielgerät nicht verbunden',
  'speech.pluginMissing': 'Plugin piper-speech ist nicht installiert.',
  'speech.textMissing': 'text fehlt',
  'speech.invalidVoice': 'Ungültige Stimme',
  'speech.invalidSpeed': 'Ungültiges Tempo',
  'speech.downloadBusy': 'Gerade läuft schon ein Download, oder die Stimme ist unbekannt.',
  'speech.notInstalled': 'Piper oder Stimme {{voice}} nicht installiert',
  'plugin.unknownEvent': '{{plugin}}: unbekannter Event-Typ "{{type}}".',
  'stems.demucsMissing': 'Demucs ist auf dem Stage-Server nicht installiert (docs/03).',
  'osc.unknownCommand': 'Unbekannter OSC-Befehl: {{type}}',
  'osc.invalidAddress': 'Keine gültige OSC-Adresse: „{{address}}“',
  'osc.noTarget': 'Für dieses OSC-Gerät fehlen Host und Port (Bühne).',
  'osc.sendFailed': 'OSC an {{host}}:{{port}} fehlgeschlagen: {{error}}',
  'job.interrupted': 'Durch einen Neustart des Stage-Servers unterbrochen.',
  'job.variantGone': 'Die Song-Variante existiert nicht mehr.',
  'job.trackGone': 'Der Track existiert nicht mehr.',
  'job.audioMissing': 'Die Audiodatei des Tracks liegt nicht auf dem Stage-Server.',
  'job.stemPluginMissing': 'Das Plugin „Spuren trennen“ ist nicht installiert.',
  'job.invalidVariantId': 'Ungültige Song-Varianten-ID.',
  'job.invalidIds': 'Ungültige Song- oder Track-ID.',
  'youtube.addonMissing': 'Das Add-on „YouTube-Download“ ist für diese Band nicht installiert.',
  'youtube.bandMissing': 'Für die YouTube-Suche fehlt die Band (Add-on-Prüfung).',
  'youtube.urlOnly': 'Nur youtube.com/youtu.be-Links werden unterstützt.',
  'youtube.downloadTimeout': 'yt-dlp hat nach {{minutes}} Minuten nicht fertig geladen und wurde abgebrochen.',
  'youtube.tooLarge': 'Die Audiospur ist größer als das Limit von {{mb}} MB.',
  'youtube.searchTimeout': 'Die YouTube-Suche hat nicht geantwortet - ist der Stage-Server online?',
  'youtube.noAudio': 'YouTube bietet zu diesem Video keine ladbare Audiospur an.',
  'youtube.noOpus': 'YouTube bietet zu diesem Video kein Opus an - das Umwandeln auf dem Gerät kommt noch.',
  'youtube.failed': 'Der YouTube-Download ist fehlgeschlagen.',
  'youtube.interrupted': 'Der Download wurde unterbrochen (App beendet) - bitte neu starten.',
  // Native helpers of add-ons (docs/32 §8) - on the device, through NativeHelperPlugin.
  'helper.missing': 'Das Hilfsprogramm des Add-ons ist auf diesem Gerät nicht installiert.',
  'helper.untrusted': 'Das Hilfsprogramm ist von jemand anderem signiert - StageBoard benutzt es nicht.',
  'helper.incompatible': 'Das Hilfsprogramm passt nicht zu dieser StageBoard-Version.',
  'helper.refused': 'Das Hilfsprogramm hat StageBoard abgelehnt (Signatur).',
  'helper.cancelled': 'Abgebrochen.',
  'helper.gone': 'Das Hilfsprogramm wurde beendet.',
  'helper.failed': 'Das Hilfsprogramm ist fehlgeschlagen.',
  'helper.badRequest': 'Das Hilfsprogramm hat den Auftrag nicht verstanden.',
  'helper.tooOld': 'Das Hilfsprogramm ist zu alt für diese StageBoard-Version.',
  'stems.notInstalled': 'Stem-Trennung ist auf dem Stage-Server nicht installiert (Demucs, siehe docs/03).',
  'ug.addonMissing': 'Das Add-on „Ultimate Guitar Import“ ist für diese Band nicht installiert.',
  'ug.bandMissing': 'Für Ultimate Guitar fehlt die Band (Add-on-Prüfung).',
  'ug.chromePathWrong': 'CHROME_EXECUTABLE_PATH zeigt auf „{{path}}“ - dort ist kein Chrome/Chromium. Pfad korrigieren oder die Variable entfernen.',
  'ug.chromeMissing': 'Für Ultimate Guitar braucht der Stage-Server Chrome oder Chromium - keins gefunden. Installieren (z. B. „sudo apt install chromium“) oder CHROME_EXECUTABLE_PATH setzen. Gesucht in: {{paths}}',
  'ug.timeout': 'Ultimate Guitar antwortet nicht ({{seconds}} s). Internetverbindung des Stage-Servers prüfen und noch einmal versuchen.',
  'ug.unavailable': 'Ultimate Guitar ist nicht erreichbar - hat der Stage-Server gerade Internet?',
  'ug.blocked': 'Ultimate Guitar hat die Anfrage als Bot blockiert. In ein paar Minuten noch einmal versuchen.',
  'ug.sourceChanged': 'Ultimate Guitar hat seine Seite umgebaut - der Import (Plugin „ultimate-guitar-scraper“) muss angepasst werden. Seitentitel: „{{title}}“',
  'ug.notImportable': 'Diese Version hat keinen Text zum Übernehmen (z. B. eine Pro- oder Video-Version). Bitte eine andere Version wählen.',
} as const

export type ServerMessageCode = keyof typeof SERVER_MESSAGES_DE

export const ServerMessageParamsSchema = z.record(z.string(), z.union([z.string(), z.number()]))
export type ServerMessageParams = z.infer<typeof ServerMessageParamsSchema>

/** What a reply or result carries next to `message` - spread into it. */
export type ServerMessage = { message: string; messageCode: ServerMessageCode; messageParams?: ServerMessageParams }

/** The German text for a code, values filled in. */
export function serverMessageText(code: ServerMessageCode, params: ServerMessageParams = {}): string {
  return SERVER_MESSAGES_DE[code].replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) => String(params[name] ?? ''))
}

/** `{ message, messageCode, messageParams }` for a reply: `send({ status: 'error', ...serverMessage('calibration.busy') })`. */
export function serverMessage(code: ServerMessageCode, params?: ServerMessageParams): ServerMessage {
  return { message: serverMessageText(code, params), messageCode: code, ...(params ? { messageParams: params } : {}) }
}

/** A thrown error that the device can translate; `message` is the German text. */
export class ServerMessageError extends Error {
  readonly messageCode: ServerMessageCode
  readonly messageParams?: ServerMessageParams
  constructor(code: ServerMessageCode, params?: ServerMessageParams, readonly cause?: unknown) {
    super(serverMessageText(code, params))
    this.name = 'ServerMessageError'
    this.messageCode = code
    if (params) this.messageParams = params
  }
}

/** The message fields of any caught error - with code when it carries one. Recognised by shape,
 * not `instanceof`: plugins may come from a separately built bundle. */
export function messageFieldsOf(err: unknown): { message: string; messageCode?: ServerMessageCode; messageParams?: ServerMessageParams } {
  if (!(err instanceof Error)) return { message: String(err) }
  const { messageCode, messageParams } = err as Error & { messageCode?: unknown; messageParams?: unknown }
  if (typeof messageCode === 'string' && messageCode in SERVER_MESSAGES_DE) {
    return { message: err.message, messageCode: messageCode as ServerMessageCode, ...(messageParams && typeof messageParams === 'object' ? { messageParams: messageParams as ServerMessageParams } : {}) }
  }
  return { message: err.message }
}
