#!/usr/bin/env bash
# Runs the productive Stage-Server from another git ref for a test, and back (docs/03 "Redeploy").
#   tools/server/deploy-ref.sh status
#   tools/server/deploy-ref.sh switch origin/<branch>     build that ref in the deploy worktree, restart
#   tools/server/deploy-ref.sh revert                     back to origin/main
# Only when the ref adds no dependencies (else `npm ci` first) and its schema changes are
# optional fields - the data (CouchDB, STAGEBOARD_STATE_DIR) stays as it is. The APK at /app is
# not rebuilt.
# Env: STAGEBOARD_DEPLOY (default ~/stageboard-deploy), STAGEBOARD_URL (default https://stageboard.local).
set -euo pipefail
DEPLOY=${STAGEBOARD_DEPLOY:-$HOME/stageboard-deploy}
URL=${STAGEBOARD_URL:-https://stageboard.local}

status() {
  echo "deploy worktree: $(git -C "$DEPLOY" log --oneline -1)"
  echo "service: $(systemctl --user is-active stageboard)"
  echo "frontend: $(curl -sk "$URL/" | grep -o 'assets/index-[a-zA-Z0-9_-]*\.js' || echo '?')"
  echo "active band set: $(curl -sk "$URL/server/active-workspace" | grep -q '^null' && echo NO || echo yes)"
}

build_and_restart() {
  cd "$DEPLOY"
  test -z "$(git status --porcelain)" || { echo "deploy worktree has changes - stopping"; exit 1; }
  if ! git diff --quiet HEAD "$1" -- package-lock.json; then echo "$1 changes dependencies - run npm ci there first"; exit 1; fi
  git checkout -q --detach "$1"
  npm run build -w shared-types >/dev/null
  npm run build -w core-backend >/dev/null
  npm run build -w stage-pwa >/dev/null
  systemctl --user restart stageboard
  for _ in $(seq 1 30); do curl -sk -o /dev/null "$URL/server/active-workspace" && break; sleep 1; done
  status
}

case "${1:-status}" in
  status) status ;;
  switch) test -n "${2:-}" || { echo "switch <ref>"; exit 2; }; git -C "$DEPLOY" fetch -q origin && build_and_restart "$2" ;;
  revert) git -C "$DEPLOY" fetch -q origin && build_and_restart origin/main ;;
  *) echo "status | switch <ref> | revert"; exit 2 ;;
esac
