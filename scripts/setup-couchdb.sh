#!/usr/bin/env bash
# One-time step for a fresh CouchDB (safe to run again): finishes the single-node setup, which
# creates CouchDB's system databases (_users, _replicator). Everything else - bands, accounts,
# `_security`, the roster validator - is created by core-backend itself (POST /workspaces,
# updateRosterValidators at every start). No CORS: devices sync through core-backend's /db proxy.
#
# Usage on the Stage-Server (login from the server-side file, docs/03 "CouchDB-Zugang"):
#   set -a; . ~/.config/stageboard/couchdb.env; set +a; scripts/setup-couchdb.sh
#
# Trimmed 2026-10-08 (Marco): it used to create test bands band-a/band-b with the account model
# of #56, an old roster validator and CORS - on a fresh server that would have been wrong.
set -euo pipefail

COUCHDB_URL="${COUCHDB_URL:-http://127.0.0.1:5984}"
COUCHDB_USER="${COUCHDB_USER:-admin}"
COUCHDB_PASSWORD="${COUCHDB_PASSWORD:-admin}"
AUTH="${COUCHDB_USER}:${COUCHDB_PASSWORD}"

echo "Waiting for CouchDB at ${COUCHDB_URL} ..."
for _ in $(seq 1 30); do
  if curl -skf -u "$AUTH" "${COUCHDB_URL}/" > /dev/null; then
    break
  fi
  sleep 1
done
curl -skf -u "$AUTH" "${COUCHDB_URL}/" > /dev/null || {
  echo "CouchDB did not answer at ${COUCHDB_URL} (login from ~/.config/stageboard/couchdb.env loaded?)" >&2
  exit 1
}

echo "Finishing single-node setup (no-op if already done) ..."
curl -sk -X POST -H "Content-Type: application/json" -u "$AUTH" \
  "${COUCHDB_URL}/_cluster_setup" -d '{"action": "finish_cluster"}' > /dev/null

for db in _users _replicator; do
  if curl -skf -u "$AUTH" "${COUCHDB_URL}/${db}" > /dev/null; then
    echo "  ${db}: ok"
  else
    echo "  ${db}: missing" >&2
    exit 1
  fi
done
echo "Done. Start the Stage-Server; the first band is founded in the app."
