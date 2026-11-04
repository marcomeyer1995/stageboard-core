import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const certFile = fileURLToPath(new URL('../../certs/dev-cert.pem', import.meta.url))
const keyFile = fileURLToPath(new URL('../../certs/dev-key.pem', import.meta.url))

// getUserMedia() (Tuner) and requestMIDIAccess() (WebMIDI) require a secure context - see
// #34. Reads the shared cert `scripts/generate-dev-certs.sh` writes, same file Fastify and
// CouchDB present, so all three agree on one self-signed origin. Falls back to plain HTTP
// if the certs haven't been generated yet, rather than crashing `npm run dev` outright -
// hardware features degrade gracefully; core song/setlist work over LAN IP does not need
// a secure context and should keep working today for anyone who hasn't run the cert script.
const https =
  existsSync(certFile) && existsSync(keyFile)
    ? { cert: readFileSync(certFile), key: readFileSync(keyFile) }
    : undefined

// Signalsmith Stretch (#683) keeps running a full stretch on silence while inactive - "Should
// detect silent input and skip processing" says its own comment - and its worklet never ends, so
// once loaded it cost ~70 % of a Fire core for good, even paused (measured 2026-11-04). Inactive
// now means: silence, no processing, and a reset on the way in so no old audio comes out when it
// starts again. Fails the build when an update changes the code, rather than shipping it unpatched.
const SIGNALSMITH_INACTIVE = `if (!currentMapSegment.active) {
				outputList[0].forEach((_, c) => {
					let channelBuffer = inputs[c%inputs.length];
					let buffer = new Float32Array(memory, this.buffersIn[c], outputBlockSize);
					buffer.fill(0);
				});
				// Should detect silent input and skip processing
				wasmModule._process(outputBlockSize, outputBlockSize);
			} else if (inputs?.length) {`
const SIGNALSMITH_IDLE = `if (!currentMapSegment.active) {
				if (!this.stageboardIdle) { this.stageboardIdle = true; wasmModule._reset(); }
				return true;
			}
			this.stageboardIdle = false;
			if (inputs?.length) {`

function signalsmithIdle(): Plugin {
  return {
    name: 'signalsmith-idle',
    enforce: 'pre',
    transform(code, id) {
      if (!/signalsmith-stretch[\\/]SignalsmithStretch\.m?js$/.test(id)) return null
      if (!code.includes(SIGNALSMITH_INACTIVE)) throw new Error('signalsmith-idle: SignalsmithStretch changed - check the patch in vite.config.ts')
      return code.replace(SIGNALSMITH_INACTIVE, SIGNALSMITH_IDLE)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), signalsmithIdle()],
  server: { https },
  build: {
    rolldownOptions: {
      output: {
        // A chunk is named after its module's folder, and @soundtouchjs ships in ".dist/" - a file
        // starting with a dot is left out of the Android app (aapt skips dotfiles), so the Loop's
        // import failed there while the browser, served by the Stage-Server, had it.
        chunkFileNames: (chunk) => `assets/${chunk.name.replace(/^\.+/, '') || 'chunk'}-[hash].js`,
      },
    },
  },
})
