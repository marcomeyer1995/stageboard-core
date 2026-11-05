window.__t = {
  sleep: ms => new Promise(r => setTimeout(r, ms)),
  btn: re => [...document.querySelectorAll('button')].find(b => re.test(b.textContent.trim()) || re.test(b.getAttribute('aria-label') || '')),
  status: () => document.querySelector('header, [class*=status]').innerText.split('\n'),
  sel(i, v) { const s = document.querySelectorAll('select')[i]; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, v); s.dispatchEvent(new Event('change', { bubbles: true })) },
  async tempo(start, trainer, steps) { const t = window.__t; t.btn(/^Tempo \d+/).click(); await t.sleep(400); const cur = () => +document.querySelector('[role=dialog]').innerText.match(/Tempo\s*\n?\s*−\s*\n?\s*(\d+) %/)[1];
    while (cur() > start) { t.btn(/^Decrease Tempo$|^Tempo verringern$/).click(); await t.sleep(60) } while (cur() < start) { t.btn(/^Increase Tempo$|^Tempo erhöhen$/).click(); await t.sleep(60) }
    const sw = document.querySelector('[role=switch]'); if ((sw.getAttribute('aria-checked') === 'true') !== trainer) { sw.click(); await t.sleep(200) }
    for (let i = 0; i < (steps || 0); i++) { t.btn(/Increase Per pass|Pro Durchgang \+ erhöhen/).click(); await t.sleep(60) }
    const txt = document.querySelector('[role=dialog]').innerText.replace(/\n/g, ' '); t.btn(/^(Done|Fertig)$/).click(); await t.sleep(300); return txt },
  async sample(n, every) { const t = window.__t, out = []; let last = ''; for (let i = 0; i < n; i++) { const st = t.status(), s = window.__sbStems; const l = `${st[0]} ${st[2]} st:${s.starts}/${s.late}/${s.reschedules}/${s.jumps} err:${s.lastErrorMs}`; if (i % every == 0 || st[0] !== last) out.push(i + 's ' + l); last = st[0]; await t.sleep(1000) } return out.join('\n') },
}
'ok'
