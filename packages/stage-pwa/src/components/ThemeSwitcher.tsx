import { THEMES, useThemeStore } from '../store/useThemeStore'
import { INPUT_FREE } from './ui/styles'
import { Segmented } from './ui'
import { useTranslation } from 'react-i18next'

/**
 * Lets a musician pick their own visual language for this device - see "StageBoard Look
 * and Feel". The light/dark toggle only makes sense for the Klassisch theme (the other
 * four are dark-only stage looks), so it disappears rather than sitting there inert.
 * Lives inside AppMenu - a look, chosen once per device, doesn't need permanent screen space.
 */
export function ThemeSwitcher() {
  const { t } = useTranslation('system')
  const themeId = useThemeStore((state) => state.themeId)
  const lightDark = useThemeStore((state) => state.lightDark)
  const setThemeId = useThemeStore((state) => state.setThemeId)
  const toggleLightDark = useThemeStore((state) => state.toggleLightDark)

  return (
    <div className="flex items-center gap-2">
      <select
        value={themeId}
        onChange={(e) => setThemeId(e.target.value as (typeof THEMES)[number]['id'])}
        title={t('theme.design')}
        className={`min-h-form flex-1 min-w-0 px-3 text-base ${INPUT_FREE}`}
      >
        {THEMES.map((theme) => (
          <option key={theme.id} value={theme.id}>
            {theme.id === 'default' ? t('theme.default') : theme.label}
          </option>
        ))}
      </select>
      {themeId === 'default' && (
        <div className="w-44 flex-shrink-0">
          <Segmented
            label={t('theme.lightDark')}
            value={lightDark}
            onChange={(next) => next !== lightDark && toggleLightDark()}
            options={[
              { value: 'dark', label: t('theme.dark') },
              { value: 'light', label: t('theme.light') },
            ]}
          />
        </div>
      )}
    </div>
  )
}
