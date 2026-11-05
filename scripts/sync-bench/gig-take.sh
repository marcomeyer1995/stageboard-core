#!/bin/bash
# gig-take.sh KIND(fresh|resume) SECONDS OUTDIR NAME - every device in DEVS records, the Redmi (master, 9302) plays
cd "$(dirname "$0")"; K=$1; T=$2; O=$3; N=$4
DEVS=${DEVS:-"fire:9301 redmi:9302"}  # serial-less: name:CDP port
for d in $DEVS; do mkdir -p $O/${d%%:*}; echo "__cap.arm(true); 'armed'" | node cdp-run.mjs ${d##*:} - >/dev/null; done
echo "(async()=>{const t=__t; const named=re=>[...document.querySelectorAll('button')].find(b=>re.test(b.textContent.trim())||re.test(b.getAttribute('aria-label')||'')); const icons=()=>[...document.querySelectorAll('button')].filter(b=>!b.textContent.trim()&&!b.getAttribute('aria-label')&&!b.title).slice(0,3); const btn=(re,i)=>named(re)??icons()[i]; btn('$K'==='fresh'?/^Stop$/i:/^Pause$/i,'$K'==='fresh'?2:1).click(); await t.sleep(1300); btn(/^Play$/i,0).click(); return 'play'})()" | node cdp-run.mjs 9302 - >/dev/null
timeout $T tail -f /dev/null
for d in $DEVS; do echo "(async()=>{ await new Promise(r=>setTimeout(r,300)); __cap.arm(false); return 'ok'})()" | node cdp-run.mjs ${d##*:} - >/dev/null; done
for d in $DEVS; do node fetch.mjs ${d##*:} $O/${d%%:*}/$N.json; done
