#!/usr/bin/env node
// Drives a tablet's Chrome tab over the DevTools Protocol via an adb port-forward, so a
// tablet-only bug (touch-drag timing, geometry, anything that never reproduces on a laptop)
// can be evaluated and its console watched live without a screen-share or a manual devtools
// window. See docs/03_Developer_Experience.md, section "Live-Tablet-Debugging".
//
// Prereqs (see docs/03 for the full walkthrough):
//   adb devices                                            # tablet must show as "device", not "unauthorized"/"no permissions"
//   adb forward tcp:9222 localabstract:chrome_devtools_remote
//
// Usage:
//   node scripts/tablet-debug.mjs list
//   node scripts/tablet-debug.mjs eval <urlSubstring> "<jsExpression>"
//   node scripts/tablet-debug.mjs watch <urlSubstring> [outFile] [pattern]
//
// <urlSubstring> matches against each open tab's URL (e.g. "5173" or "192.168.178.158").
// If it matches more than one tab, the first is used - re-run `list` and be more specific,
// or close the extra tab on the tablet, if that picks the wrong one.

import { writeFileSync, appendFileSync } from 'node:fs'

const CDP_PORT = 9222

async function listTargets() {
  const res = await fetch(`http://localhost:${CDP_PORT}/json`)
  if (!res.ok) {
    throw new Error(
      `Can't reach CDP on :${CDP_PORT} (${res.status}). Is 'adb forward tcp:${CDP_PORT} localabstract:chrome_devtools_remote' running, and the tablet's screen unlocked?`,
    )
  }
  return res.json()
}

function pickTarget(targets, urlSubstring) {
  const pages = targets.filter((t) => t.type === 'page' && t.url.includes(urlSubstring))
  if (pages.length === 0) {
    throw new Error(
      `No open tab matches "${urlSubstring}". Open tabs:\n${targets.map((t) => `  ${t.type}\t${t.url}`).join('\n')}`,
    )
  }
  if (pages.length > 1) {
    console.error(`Warning: ${pages.length} tabs match "${urlSubstring}", using the first.`)
  }
  return pages[0]
}

function wsFor(target) {
  return new WebSocket(target.webSocketDebuggerUrl)
}

async function evalOnce(urlSubstring, expression) {
  const target = pickTarget(await listTargets(), urlSubstring)
  const ws = wsFor(target)
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('timeout')), 8000)
    ws.addEventListener('open', () => {
      ws.send(
        JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: { expression, returnByValue: true, awaitPromise: true },
        }),
      )
    })
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data)
      if (msg.id === 1) {
        clearTimeout(timeout)
        ws.close()
        resolve(msg.result ?? msg.error)
      }
    })
    ws.addEventListener('error', (err) => {
      clearTimeout(timeout)
      reject(err)
    })
  })
}

function fmtArg(arg) {
  if (arg.type === 'string') return arg.value
  if (arg.value !== undefined) return JSON.stringify(arg.value)
  if (arg.preview) {
    const props = (arg.preview.properties || []).map((p) => `${p.name}: ${p.value}`).join(', ')
    return `${arg.className ?? arg.subtype ?? arg.type}{${props}}`
  }
  return arg.description ?? arg.type
}

async function watch(urlSubstring, outFile, pattern) {
  const target = pickTarget(await listTargets(), urlSubstring)
  const re = pattern ? new RegExp(pattern) : null
  if (outFile) writeFileSync(outFile, '')
  const ws = wsFor(target)
  ws.addEventListener('open', () => {
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }))
    console.error(`[tablet-debug] attached to ${target.url}${outFile ? `, writing to ${outFile}` : ''}`)
  })
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data)
    if (msg.method !== 'Runtime.consoleAPICalled') return
    const { type, args, timestamp } = msg.params
    const line = args.map(fmtArg).join(' ')
    if (re && !re.test(line)) return
    const stamped = `${new Date(timestamp).toISOString()} [${type}] ${line}\n`
    process.stdout.write(stamped)
    if (outFile) appendFileSync(outFile, stamped)
  })
  ws.addEventListener('close', () => {
    console.error('[tablet-debug] connection closed')
    process.exit(0)
  })
}

const [, , cmd, ...args] = process.argv

if (cmd === 'list') {
  const targets = await listTargets()
  for (const t of targets) console.log(`${t.type}\t${t.url}\t${t.id}`)
} else if (cmd === 'eval') {
  const [urlSubstring, expression] = args
  if (!urlSubstring || !expression) {
    console.error('Usage: tablet-debug.mjs eval <urlSubstring> "<jsExpression>"')
    process.exit(1)
  }
  console.log(JSON.stringify(await evalOnce(urlSubstring, expression), null, 2))
} else if (cmd === 'watch') {
  const [urlSubstring, outFile, pattern] = args
  if (!urlSubstring) {
    console.error('Usage: tablet-debug.mjs watch <urlSubstring> [outFile] [pattern]')
    process.exit(1)
  }
  await watch(urlSubstring, outFile, pattern)
} else {
  console.error('Usage: tablet-debug.mjs <list | eval | watch> ...')
  process.exit(1)
}
