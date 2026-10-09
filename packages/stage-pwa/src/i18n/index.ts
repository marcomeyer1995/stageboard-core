import i18n from 'i18next'
import { initReactI18next, useTranslation } from 'react-i18next'

/**
 * The app's languages (#456): every folder in `locales/` is one, every file in it a namespace
 * (`common`, `statusbar`, …). Bundled into the app - offline, also in the native app - and found
 * here by the build, so a new language is a new folder and nothing else. A key a language doesn't
 * have yet falls back to English, then German.
 *
 * Band content (song titles, lyrics, notes, setlist and dashboard names) is never translated.
 */
const files = import.meta.glob<Record<string, unknown>>('./locales/*/*.json', { eager: true, import: 'default' })

export const resources: Record<string, Record<string, Record<string, unknown>>> = {}
for (const [path, content] of Object.entries(files)) {
  const [, language, namespace] = /\.\/locales\/([^/]+)\/([^/]+)\.json$/.exec(path) ?? []
  if (!language || !namespace) continue
  ;(resources[language] ??= {})[namespace] = content
}

export const FALLBACK_LANGUAGES = ['en', 'de']
export const DEFAULT_LANGUAGE = 'de'

/** The languages this build has, with their own name ("Deutsch", "English") from common.json. */
export const LANGUAGES: { code: string; name: string }[] = Object.keys(resources)
  .sort()
  .map((code) => ({ code, name: ((resources[code]?.common?.language as { name?: string } | undefined)?.name) ?? code }))

/** `auto` follows the device's own language (navigator.languages), else German. */
export type LanguageChoice = 'auto' | string

export function resolveLanguage(choice: LanguageChoice, deviceLanguages: readonly string[] = typeof navigator === 'undefined' ? [] : navigator.languages ?? [navigator.language]): string {
  if (choice !== 'auto' && resources[choice]) return choice
  for (const tag of deviceLanguages) {
    const base = tag.toLowerCase().split('-')[0]!
    if (resources[base]) return base
  }
  return DEFAULT_LANGUAGE
}

const STORAGE_KEY = 'stageboard-language'

export function readStoredLanguageChoice(): LanguageChoice {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? 'auto'
  } catch {
    return 'auto'
  }
}

/** Sets this device's language at once - every component using `useTranslation` re-renders, no reload. */
export function applyLanguageChoice(choice: LanguageChoice): void {
  try {
    if (choice === 'auto') localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, choice)
  } catch {
    // Private mode / blocked storage: the choice still holds for this session.
  }
  const language = resolveLanguage(choice)
  if (typeof document !== 'undefined') document.documentElement.lang = language
  void i18n.changeLanguage(language)
}

void i18n.use(initReactI18next).init({
  resources,
  lng: resolveLanguage(readStoredLanguageChoice()),
  fallbackLng: FALLBACK_LANGUAGES,
  defaultNS: 'common',
  ns: Object.keys(resources[DEFAULT_LANGUAGE] ?? {}),
  // React escapes already.
  interpolation: { escapeValue: false },
  initAsync: false,
})
if (typeof document !== 'undefined') document.documentElement.lang = i18n.language

export default i18n

/**
 * The language to format dates, times and numbers in (`Intl`) - this device's chosen one, so a
 * date reads "9. Okt." in German and "9 Oct" in English. A component re-renders when it changes.
 */
export function useLocale(): string {
  return useTranslation().i18n.language
}
