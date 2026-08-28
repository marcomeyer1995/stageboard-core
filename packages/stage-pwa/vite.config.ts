import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
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

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: { https },
})
