/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Build number of the native Android app (scripts/build-android-app.sh, #348) - unset in browser builds. */
  readonly VITE_APP_VERSION_CODE?: string
  /** '1' in the dev app's build ("StageBoard Dev", docs/03 §0c) - offers the test plugins. */
  readonly VITE_DEV_APP?: string
}
