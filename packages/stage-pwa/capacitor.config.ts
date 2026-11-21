import type { CapacitorConfig } from '@capacitor/cli'

/**
 * The native Android app (#348): the same React build (`dist`) bundled into a Capacitor shell.
 * The app's own origin is `https://localhost` - the Host address comes from pairing
 * (useHostUrlStore), not from where the page was loaded.
 */
const config: CapacitorConfig = {
  appId: 'de.stageboard.app',
  appName: 'StageBoard',
  webDir: 'dist',
  android: {
    // The Host sends no mixed content; everything is https.
    allowMixedContent: false,
  },
}

export default config
