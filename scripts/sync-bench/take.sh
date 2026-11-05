#!/bin/bash
# take.sh PORT KIND SECONDS OUT.json
cd "$(dirname "$0")"
sed -e "s/KIND/'$2'/; s/SECONDS \* 1000/$3 * 1000/" run.js > .run-$1.js
node cdp-run.mjs $1 .run-$1.js >/dev/null && node fetch.mjs $1 $4
