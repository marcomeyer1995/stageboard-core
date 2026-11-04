// one take: KIND = fresh | resume, SECONDS
(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const named = re => [...document.querySelectorAll('button')].find(b => re.test(b.textContent.trim()) || re.test(b.getAttribute('aria-label') || ''))
  // Icon-only transport (portrait): the three unnamed buttons before "Vorheriger/Previous song".
  const icons = () => [...document.querySelectorAll('button')].filter(b => !b.textContent.trim() && !b.getAttribute('aria-label') && !b.title).slice(0, 3)
  const btn = re => named(re) ?? icons()[{ Play: 0, Pause: 1, Stop: 2 }[re.source.replace(/[\^$]/g, '')]]
  btn(KIND === 'fresh' ? /^Stop$/ : /^Pause$/).click()
  await sleep(1300)
  __cap.arm(true)
  btn(/^Play$/).click()
  await sleep(600)
  const st = JSON.parse(localStorage.getItem('stageboard-practice-state')).state.byWorkspace
  const ws = Object.values(st).find(w => w.playbackStatus === 'playing')
  __cap.transport = ws ? { startedAt: ws.playbackStartedAt, accumulatedMs: ws.playbackAccumulatedMs, rate: ws.playbackRate ?? 1 } : null
  await sleep(SECONDS * 1000 - 600)
  await sleep(300); __cap.arm(false)
  return JSON.stringify(__cap.transport)
})()
