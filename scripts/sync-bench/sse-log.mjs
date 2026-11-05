// Logs the master's show-state pushes with the laptop's (= server's) receive time.
import { appendFileSync } from 'node:fs'
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
const [url, out] = process.argv.slice(2)
const res = await fetch(url)
const dec = new TextDecoder(); let buf = ''
for await (const chunk of res.body) {
  buf += dec.decode(chunk, { stream: true })
  let i
  while ((i = buf.indexOf('\n\n')) >= 0) { const ev = buf.slice(0, i); buf = buf.slice(i + 2); const line = ev.split('\n').find(l => l.startsWith('data: ')); if (line) appendFileSync(out, JSON.stringify({ recv: Date.now(), push: JSON.parse(line.slice(6)) }) + '\n') }
}
