import { createHash } from 'node:crypto'
import { createWriteStream, existsSync, readdirSync, statSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { SpeechVoiceKeySchema, type SpeechVoice, type SpeechVoiceDownload, type SpeechVoiceLicense, type SpeechVoicesResponse } from 'shared-types'

/**
 * The voices piper-speech can speak with (#63): Piper's official list (fetched once, kept on disk
 * for offline use), a few voices StageBoard knows from elsewhere (dialects), and whatever is
 * installed. A voice is downloaded on request - at home, the gig itself needs no internet.
 */

const PIPER_VOICES_BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/'
const CATALOG_MAX_AGE_MS = 7 * 24 * 3600 * 1000

interface CatalogEntry {
  key: string
  name: string
  language: { code: string; name_native: string; country_english?: string }
  quality: string
  files: Record<string, { size_bytes: number; md5_digest: string }>
}

interface ExtraVoice {
  key: string
  name: string
  languageCode: string
  languageName: string
  quality: string
  sizeBytes: number
  onnxUrl: string
  configUrl: string
  license: string
  finetunedFrom: string | null
}

/** Voices outside Piper's list. Hessian: Thorsten-Voice's dialect voice, CC0 (huggingface.co/Thorsten-Voice/Hessisch). */
export const EXTRA_VOICES: ExtraVoice[] = [
  {
    key: 'de_DE-thorsten_hessisch-high',
    name: 'Thorsten Hessisch',
    languageCode: 'de_DE',
    languageName: 'Deutsch – Hessisch',
    quality: 'high',
    sizeBytes: 113_800_453,
    onnxUrl: 'https://huggingface.co/Thorsten-Voice/Hessisch/resolve/main/Thorsten-Voice_Hessisch_Piper_high-Oct2023.onnx',
    configUrl: 'https://huggingface.co/Thorsten-Voice/Hessisch/resolve/main/Thorsten-Voice_Hessisch_Piper_high-Oct2023.onnx.json',
    license: 'CC0-1.0',
    finetunedFrom: null,
  },
]

type Fetch = typeof globalThis.fetch

/** Model-card lines: `* License: CC0`, and `Finetuned from U.S. English lessac voice …`. */
export function parseModelCard(card: string): { license: string | null; finetunedFrom: string | null } {
  let license = /License:\s*(.+)/i.exec(card)?.[1]?.trim() ?? null
  // Several cards only say "See URL" - the licence is behind the dataset's link.
  if (license && /^see url$/i.test(license)) {
    const url = /URL:\s*(\S+)/i.exec(card)?.[1]
    license = url ? `siehe ${url}` : null
  }
  const finetunedFrom = /Fine-?tuned from\s+(.+?)\.?\s*$/im.exec(card)?.[1]?.trim() ?? null
  return { license, finetunedFrom }
}

export class SpeechVoices {
  private catalog: Record<string, CatalogEntry> | null = null
  private catalogSource: 'online' | 'cached' | 'none' = 'none'
  private download: SpeechVoiceDownload | null = null

  constructor(
    private readonly voicesDir: string,
    private readonly fetchFn: Fetch = globalThis.fetch,
  ) {}

  private get catalogFile(): string {
    return join(this.voicesDir, 'voices.json')
  }

  /** Path of an installed voice's model, or null. */
  voicePath(key: string): string | null {
    const file = join(this.voicesDir, `${key}.onnx`)
    return existsSync(file) && existsSync(`${file}.json`) ? file : null
  }

  private async loadCatalog(): Promise<void> {
    const cached = existsSync(this.catalogFile)
    const fresh = cached && Date.now() - statSync(this.catalogFile).mtimeMs < CATALOG_MAX_AGE_MS
    if (this.catalog && fresh) return
    if (!fresh) {
      try {
        const response = await this.fetchFn(`${PIPER_VOICES_BASE}voices.json`)
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const text = await response.text()
        this.catalog = JSON.parse(text) as Record<string, CatalogEntry>
        await mkdir(this.voicesDir, { recursive: true })
        await writeFile(this.catalogFile, text)
        this.catalogSource = 'online'
        return
      } catch {
        // Offline: the saved copy below.
      }
    }
    if (cached) {
      this.catalog = JSON.parse(await readFile(this.catalogFile, 'utf8')) as Record<string, CatalogEntry>
      this.catalogSource = 'cached'
    }
  }

  async list(piperInstalled: boolean): Promise<SpeechVoicesResponse> {
    await this.loadCatalog()
    const voices: SpeechVoice[] = []
    for (const entry of Object.values(this.catalog ?? {})) {
      const size = Object.entries(entry.files).find(([path]) => path.endsWith('.onnx'))?.[1].size_bytes ?? 0
      voices.push({
        key: entry.key,
        name: entry.name,
        languageCode: entry.language.code,
        languageName: entry.language.country_english ? `${entry.language.name_native} (${entry.language.country_english})` : entry.language.name_native,
        quality: entry.quality,
        sizeBytes: size,
        installed: this.voicePath(entry.key) !== null,
        origin: 'piper',
      })
    }
    for (const extra of EXTRA_VOICES) {
      voices.push({ key: extra.key, name: extra.name, languageCode: extra.languageCode, languageName: extra.languageName, quality: extra.quality, sizeBytes: extra.sizeBytes, installed: this.voicePath(extra.key) !== null, origin: 'extra' })
    }
    // Voices put there by hand, known to neither list.
    if (existsSync(this.voicesDir)) {
      for (const file of readdirSync(this.voicesDir)) {
        const key = file.endsWith('.onnx') ? file.slice(0, -5) : null
        if (key && !voices.some((v) => v.key === key) && this.voicePath(key)) {
          voices.push({ key, name: key, languageCode: key.split('-')[0] ?? '', languageName: key.split('-')[0] ?? '', quality: '', sizeBytes: statSync(join(this.voicesDir, file)).size, installed: true, origin: 'local' })
        }
      }
    }
    // One odd entry in Piper's list must not break the whole list for the app.
    const valid = voices.filter((v) => SpeechVoiceKeySchema.safeParse(v.key).success)
    valid.sort((a, b) => a.languageCode.localeCompare(b.languageCode) || a.name.localeCompare(b.name) || a.quality.localeCompare(b.quality))
    return { voices: valid, download: this.download, catalog: this.catalogSource, piperInstalled }
  }

  async license(key: string): Promise<SpeechVoiceLicense> {
    const extra = EXTRA_VOICES.find((v) => v.key === key)
    if (extra) return { key, license: extra.license, finetunedFrom: extra.finetunedFrom }
    const cardFile = join(this.voicesDir, `${key}.MODEL_CARD`)
    let card: string | null = existsSync(cardFile) ? await readFile(cardFile, 'utf8') : null
    if (card === null) {
      await this.loadCatalog()
      const path = Object.keys(this.catalog?.[key]?.files ?? {}).find((p) => p.endsWith('MODEL_CARD'))
      if (path) {
        try {
          const response = await this.fetchFn(PIPER_VOICES_BASE + path)
          if (response.ok) {
            card = await response.text()
            await mkdir(this.voicesDir, { recursive: true })
            await writeFile(cardFile, card)
          }
        } catch {
          // Offline: unknown for now.
        }
      }
    }
    return { key, ...(card ? parseModelCard(card) : { license: null, finetunedFrom: null }) }
  }

  /** Starts downloading a voice; false when one is already running or the key is unknown. */
  async install(key: string): Promise<boolean> {
    if (this.download?.state === 'running') return false
    await this.loadCatalog()
    const files = this.filesOf(key)
    if (!files) return false
    const totalBytes = files.reduce((sum, f) => sum + f.size, 0)
    const job: SpeechVoiceDownload = { key, receivedBytes: 0, totalBytes, state: 'running' }
    this.download = job
    void (async () => {
      try {
        await mkdir(this.voicesDir, { recursive: true })
        for (const file of files) await this.fetchTo(file, job)
        job.state = 'done'
      } catch (err) {
        job.state = 'failed'
        job.error = err instanceof Error ? err.message : String(err)
      }
    })()
    return true
  }

  private filesOf(key: string): { url: string; target: string; size: number; md5: string | null }[] | null {
    const extra = EXTRA_VOICES.find((v) => v.key === key)
    if (extra) {
      return [
        { url: extra.configUrl, target: `${key}.onnx.json`, size: 0, md5: null },
        { url: extra.onnxUrl, target: `${key}.onnx`, size: extra.sizeBytes, md5: null },
      ]
    }
    const entry = this.catalog?.[key]
    if (!entry) return null
    // Model last: a voice counts as installed once both its config and model are there.
    const order = (path: string) => (path.endsWith('.onnx') ? 2 : 1)
    return Object.entries(entry.files)
      .sort(([a], [b]) => order(a) - order(b))
      .map(([path, info]) => ({
        url: PIPER_VOICES_BASE + path,
        target: path.endsWith('MODEL_CARD') ? `${key}.MODEL_CARD` : path.endsWith('.onnx.json') ? `${key}.onnx.json` : `${key}.onnx`,
        size: info.size_bytes,
        md5: info.md5_digest,
      }))
  }

  private async fetchTo(file: { url: string; target: string; md5: string | null }, job: SpeechVoiceDownload): Promise<void> {
    const response = await this.fetchFn(file.url)
    if (!response.ok || !response.body) throw new Error(`${file.target}: HTTP ${response.status}`)
    const target = join(this.voicesDir, file.target)
    const tmp = `${target}.part`
    const hash = createHash('md5')
    const count = new Transform({
      transform(chunk: Buffer, _enc, done) {
        hash.update(chunk)
        job.receivedBytes += chunk.length
        done(null, chunk)
      },
    })
    try {
      await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), count, createWriteStream(tmp))
      const md5 = hash.digest('hex')
      if (file.md5 && md5 !== file.md5) throw new Error(`${file.target}: Prüfsumme stimmt nicht`)
      await rename(tmp, target)
    } finally {
      await rm(tmp, { force: true })
    }
  }
}
