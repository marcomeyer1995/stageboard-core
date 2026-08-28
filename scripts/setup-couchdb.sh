#!/usr/bin/env bash
# One-time (but safely re-runnable) setup for the local CouchDB dev instance
# started via `docker compose up -d`: finishes single-node cluster setup
# (creates the _users/_replicator/_global_changes system DBs), creates the
# app database, and enables CORS so the browser-side PouchDB can sync to it.
set -euo pipefail

# -k on every curl call: harmless against plain HTTP, but required if COUCHDB_URL points
# at the self-signed HTTPS port (6984, see #34/generate-dev-certs.sh) - this script only
# ever talks to CouchDB directly on localhost, never to a browser, so skipping cert
# verification here doesn't weaken the actual secure-context guarantee that matters.
COUCHDB_URL="${COUCHDB_URL:-http://localhost:5984}"
COUCHDB_USER="${COUCHDB_USER:-admin}"
COUCHDB_PASSWORD="${COUCHDB_PASSWORD:-admin}"
COUCHDB_DB="${COUCHDB_DB:-stageboard-songs}"
FRONTEND_ORIGIN="${FRONTEND_ORIGIN:-http://localhost:5173}"

AUTH="${COUCHDB_USER}:${COUCHDB_PASSWORD}"

echo "Waiting for CouchDB at ${COUCHDB_URL} ..."
for _ in $(seq 1 30); do
  if curl -skf -u "$AUTH" "${COUCHDB_URL}/" > /dev/null; then
    break
  fi
  sleep 1
done
curl -skf -u "$AUTH" "${COUCHDB_URL}/" > /dev/null || {
  echo "CouchDB did not become ready at ${COUCHDB_URL}" >&2
  exit 1
}

echo "Finishing single-node cluster setup (no-op if already done) ..."
curl -sk -X POST -H "Content-Type: application/json" -u "$AUTH" \
  "${COUCHDB_URL}/_cluster_setup" -d '{"action": "finish_cluster"}' > /dev/null

echo "Ensuring database '${COUCHDB_DB}' exists ..."
status=$(curl -sk -o /dev/null -w '%{http_code}' -X PUT -u "$AUTH" "${COUCHDB_URL}/${COUCHDB_DB}")
if [ "$status" != "201" ] && [ "$status" != "412" ]; then
  echo "Unexpected response creating database: HTTP $status" >&2
  exit 1
fi

echo "Enabling CORS for ${FRONTEND_ORIGIN} ..."
curl -sk -X PUT -u "$AUTH" "${COUCHDB_URL}/_node/_local/_config/httpd/enable_cors" -d '"true"' > /dev/null
curl -sk -X PUT -u "$AUTH" "${COUCHDB_URL}/_node/_local/_config/cors/origins" -d "\"${FRONTEND_ORIGIN}\"" > /dev/null
curl -sk -X PUT -u "$AUTH" "${COUCHDB_URL}/_node/_local/_config/cors/credentials" -d '"true"' > /dev/null
curl -sk -X PUT -u "$AUTH" "${COUCHDB_URL}/_node/_local/_config/cors/methods" -d '"GET, PUT, POST, HEAD, DELETE"' > /dev/null
curl -sk -X PUT -u "$AUTH" "${COUCHDB_URL}/_node/_local/_config/cors/headers" \
  -d '"accept, authorization, content-type, origin, referer, x-csrf-token"' > /dev/null

echo "Done. CouchDB ready at ${COUCHDB_URL}/${COUCHDB_DB} (CORS allowed from ${FRONTEND_ORIGIN})."
