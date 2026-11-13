// A minimal Chrome DevTools Protocol client over the built-in WebSocket (Node 22+).

/** Connects to the first page target on `port`. */
export async function connectPage(port, match) {
  const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
  const page = list.find((t) => t.type === 'page' && (!match || t.url.includes(match)))
  if (!page) throw new Error(`no page on port ${port}${match ? ` matching "${match}"` : ''}`)
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })
  let id = 0
  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const my = ++id
      const onMessage = (e) => {
        const m = JSON.parse(e.data)
        if (m.id !== my) return
        ws.removeEventListener('message', onMessage)
        if (m.error) reject(new Error(`${method}: ${m.error.message}`))
        else resolve(m.result)
      }
      ws.addEventListener('message', onMessage)
      ws.send(JSON.stringify({ id: my, method, params }))
    })
  return { call, close: () => ws.close(), url: page.url }
}

/** Evaluates an expression in the page (awaits promises) and returns its JSON value. */
export async function evaluate(page, expression) {
  const r = await page.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) return { error: r.exceptionDetails.exception?.description ?? r.exceptionDetails.text }
  return r.result?.value
}

/** Rejects after `ms` - a locked device's page can hang an answer for minutes. */
export function within(ms, promise) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`no answer in ${ms} ms`)), ms))])
}
