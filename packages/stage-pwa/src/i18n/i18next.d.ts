import 'i18next'
import type common from './locales/de/common.json'
import type statusbar from './locales/de/statusbar.json'

/**
 * Typed keys (#456): German is the reference - a key that isn't in de/*.json is a compile error.
 * A new namespace (a new file in locales/de/) is added here too; the guard test
 * (i18n/locales.test.ts) checks every other language has the same keys.
 */
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common'
    resources: {
      common: typeof common
      statusbar: typeof statusbar
    }
  }
}
