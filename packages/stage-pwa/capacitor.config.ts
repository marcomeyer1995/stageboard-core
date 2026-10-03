import type { CapacitorConfig } from '@capacitor/cli'

/**
 * The native Android app (#348): the same React build (`dist`) bundled into a Capacitor shell.
 * The app's own origin is `https://localhost` - the Stage-Server address comes from pairing
 * (useStageServerStore), not from where the page was loaded.
 */
const config: CapacitorConfig = {
  appId: 'de.stageboard.app',
  appName: 'StageBoard',
  webDir: 'dist',
  android: {
    // The Stage-Server sends no mixed content; everything is https.
    allowMixedContent: false,
  },
}

export default config
