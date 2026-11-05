#!/bin/bash
# prep.sh SERIAL PORT
S=$1; PORT=$2; cd "$(dirname "$0")"
adb -s $S shell am force-stop de.stageboard.app.dev
adb -s $S shell monkey -p de.stageboard.app.dev -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
timeout 8 tail -f /dev/null
P=$(adb -s $S shell pidof de.stageboard.app.dev)
adb -s $S forward --remove tcp:$PORT 2>/dev/null; adb -s $S forward tcp:$PORT localabstract:webview_devtools_remote_$P >/dev/null
node inject.mjs $PORT capture.js >/dev/null
timeout 8 tail -f /dev/null
node cdp-run.mjs $PORT ui.js >/dev/null
echo "$S pid $P"
