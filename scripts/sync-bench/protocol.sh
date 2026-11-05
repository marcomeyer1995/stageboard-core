#!/bin/bash
# protocol.sh PORT OUTDIR  - 3 fresh + 9 resume takes of 8 s, then one fresh 300 s take
cd "$(dirname "$0")"; P=$1; O=$2; mkdir -p $O
n=0
for k in fresh fresh fresh resume resume resume resume resume resume resume resume resume; do n=$((n+1)); ./take.sh $P $k 8 $O/t$(printf %02d $n)-$k.json || echo "take $n failed"; done
./take.sh $P fresh 300 $O/long-300s.json || echo "long failed"
echo done $O
