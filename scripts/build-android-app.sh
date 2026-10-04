#!/usr/bin/env bash
# Builds the signed StageBoard Android app (#348) from this checkout and puts it where the
# Stage-Server serves it (/app): stageboard.apk + version.json in $STAGEBOARD_APP_DIR
# (default ~/stageboard-data/app). Run it from the deploy worktree on every redeploy that
# changes stage-pwa, so the app and the server always come from the same commit.
#
# Needs the toolchain from docs/03 §0c (JDK 21, Android SDK - in the home directory) and the
# signing key ~/stageboard-data/android/keystore.properties (override: STAGEBOARD_KEYSTORE_PROPERTIES).
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
export JAVA_HOME=${JAVA_HOME:-$HOME/.local/share/jdk/current}
export ANDROID_HOME=${ANDROID_HOME:-$HOME/Android/Sdk}
OUT=${STAGEBOARD_APP_DIR:-$HOME/stageboard-data/app}

# Commit count: always rising along main, so "newer" is a plain number comparison.
# STAGEBOARD_VERSION_CODE overrides it - only for testing the update path.
CODE=${STAGEBOARD_VERSION_CODE:-$(git -C "$ROOT" rev-list --count HEAD)}
NAME="1.$CODE ($(git -C "$ROOT" rev-parse --short HEAD))"

cd "$ROOT"
VITE_APP_VERSION_CODE=$CODE npm run build -w stage-pwa
(cd packages/stage-pwa && npx cap sync android)
(cd packages/stage-pwa/android && ./gradlew assembleRelease -q -PstageboardVersionCode="$CODE" -PstageboardVersionName="$NAME")

APK=packages/stage-pwa/android/app/build/outputs/apk/release/app-release.apk
if [ ! -f "$APK" ]; then
  echo "No signed release APK - is the signing key in place? (see docs/03 §0c)" >&2
  exit 1
fi

mkdir -p "$OUT"
# Replace atomically: a download running right now keeps reading the old file.
cp "$APK" "$OUT/stageboard.apk.tmp" && mv "$OUT/stageboard.apk.tmp" "$OUT/stageboard.apk"
printf '{"versionCode":%s,"versionName":"%s","builtAt":"%s"}\n' "$CODE" "$NAME" "$(date -u +%FT%TZ)" > "$OUT/version.json.tmp"
mv "$OUT/version.json.tmp" "$OUT/version.json"
echo "StageBoard app $NAME -> $OUT"
