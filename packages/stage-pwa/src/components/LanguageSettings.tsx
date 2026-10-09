import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { applyLanguageChoice, LANGUAGES, readStoredLanguageChoice, resolveLanguage, type LanguageChoice } from '../i18n'
import { Select } from './ui'

/**
 * This device's language (#456) - like the theme, per device: two musicians of one band can read
 * different languages at the same time. "Automatisch" follows the device's own language. Each
 * language is listed in its own name, so it can be found without reading the current one.
 */
export function LanguageSettings() {
  const { t } = useTranslation('common')
  const [choice, setChoice] = useState<LanguageChoice>(readStoredLanguageChoice)
  const deviceLanguage = LANGUAGES.find((language) => language.code === resolveLanguage('auto'))?.name ?? ''
  return (
    <Select
      aria-label="Sprache · Language"
      value={choice}
      onChange={(event) => {
        setChoice(event.target.value)
        applyLanguageChoice(event.target.value)
      }}
      options={[{ value: 'auto', label: t('language.auto', { name: deviceLanguage }) }, ...LANGUAGES.map((language) => ({ value: language.code, label: language.name }))]}
    />
  )
}
