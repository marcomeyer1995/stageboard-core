#!/bin/bash
# full.sh LABEL - prepare both tablets, run the protocol on both in parallel
cd "$(dirname "$0")"; L=$1
for d in "G001NW0621470ANB 9301" "192.168.178.160:5555 9302"; do set -- $d; ./prep.sh $1 $2 >/dev/null; for i in 1 2 3; do [ "$(echo 'typeof window.__cap' | node cdp-run.mjs $2 -)" = object ] && break; node inject.mjs $2 capture.js >/dev/null; timeout 10 tail -f /dev/null; node cdp-run.mjs $2 ui.js >/dev/null; done; echo "(async()=>{await __t.sleep(1000); __t.btn(/^MONITORING$/i)?.click(); await __t.sleep(800); return typeof window.__cap+' '+__t.status().slice(0,3).join(' ')})()" | node cdp-run.mjs $2 -; done
timeout 60 tail -f /dev/null
(./protocol.sh 9301 $L/fire > $L-fire.log 2>&1 &)
./protocol.sh 9302 $L/redmi > $L-redmi.log 2>&1
timeout 20 tail -f /dev/null
cat $L-fire.log $L-redmi.log
