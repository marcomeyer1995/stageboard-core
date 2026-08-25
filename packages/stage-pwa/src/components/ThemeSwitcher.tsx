import { THEMES, useThemeStore } from '../store/useThemeStore'

/**
 * Lets a musician pick their own visual language for this device - see "StageBoard Look
 * and Feel". The light/dark toggle only makes sense for the Klassisch theme (the other
 * four are dark-only stage looks), so it disappears rather than sitting there inert.
 * Lives inside AppMenu - a look, chosen once per device, doesn't need permanent screen space.
 */
export function ThemeSwitcher() {
  const themeId = useThemeStore((state) => state.themeId)
  const lightDark = useThemeStore((state) => state.lightDark)
  const setThemeId = useThemeStore((state) => state.setThemeId)
  const toggleLightDark = useThemeStore((state) => state.toggleLightDark)

  return (
    <div className="flex items-center gap-2">
      <select
        value={themeId}
        onChange={(e) => setThemeId(e.target.value as (typeof THEMES)[number]['id'])}
        title="Design"
        className="h-12 flex-1 rounded-sb bg-control px-3 text-base text-ink-soft"
      >
        {THEMES.map((theme) => (
          <option key={theme.id} value={theme.id}>
            {theme.label}
          </option>
        ))}
      </select>
      {themeId === 'default' && (
        <button
          type="button"
          onClick={toggleLightDark}
          title={lightDark === 'dark' ? 'Light Mode' : 'Dark Mode'}
          className="h-12 flex-shrink-0 rounded-sb bg-control px-4 text-base text-ink-soft hover:bg-control-hover"
        >
          {lightDark === 'dark' ? 'Light' : 'Dark'}
        </button>
      )}
    </div>
  )
}
