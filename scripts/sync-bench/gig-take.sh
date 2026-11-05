#!/bin/bash
# gig-take.sh KIND(fresh|resume) SECONDS OUTDIR NAME - both tablets record, the Redmi (master) plays
cd "$(dirname "$0")"; K=$1; T=$2; O=$3; N=$4; mkdir -p $O/fire $O/redmi
for p in 9301 9302; do echo "__cap.arm(true); 'armed'" | node cdp-run.mjs $p - >/dev/null; done
echo "(async()=>{const t=__t; const named=re=>[...document.querySelectorAll('button')].find(b=>re.test(b.textContent.trim())||re.test(b.getAttribute('aria-label')||'')); const icons=()=>[...document.querySelectorAll('button')].filter(b=>!b.textContent.trim()&&!b.getAttribute('aria-label')&&!b.title).slice(0,3); const btn=(re,i)=>named(re)??icons()[i]; btn('$K'==='fresh'?/^Stop$/i:/^Pause$/i,'$K'==='fresh'?2:1).click(); await t.sleep(1300); btn(/^Play$/i,0).click(); return 'play'})()" | node cdp-run.mjs 9302 - >/dev/null
timeout $T tail -f /dev/null
for p in 9301 9302; do echo "(async()=>{ await new Promise(r=>setTimeout(r,300)); __cap.arm(false); return 'ok'})()" | node cdp-run.mjs $p - >/dev/null; done
node fetch.mjs 9301 $O/fire/$N.json; node fetch.mjs 9302 $O/redmi/$N.json
