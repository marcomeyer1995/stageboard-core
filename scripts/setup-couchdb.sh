#!/usr/bin/env bash
# One-time (but safely re-runnable) setup for the local CouchDB dev instance
# started via `docker compose up -d`: finishes single-node cluster setup
# (creates the _users/_replicator/_global_changes system DBs), enables CORS
# so the browser-side PouchDB can sync to it, and provisions each workspace's
# two CouchDB users (member + database-admin, see #56), database, `_security`
# doc, and `_design/roster` validation doc (see #12/#56) - the app-database
# equivalent of core-backend's `POST /workspaces` route, used here to bootstrap
# the two default workspaces before core-backend necessarily exists/runs.
set -euo pipefail

# -k on every curl call: harmless against plain HTTP, but required if COUCHDB_URL points
# at the self-signed HTTPS port (6984, see #34/generate-dev-certs.sh) - this script only
# ever talks to CouchDB directly on localhost, never to a browser, so skipping cert
# verification here doesn't weaken the actual secure-context guarantee that matters.
COUCHDB_URL="${COUCHDB_URL:-http://localhost:5984}"
COUCHDB_USER="${COUCHDB_USER:-admin}"
COUCHDB_PASSWORD="${COUCHDB_PASSWORD:-admin}"
# Matches useWorkspaceStore.ts's DEFAULT_WORKSPACES - a new workspace created later via the
# PWA's "+" button is provisioned on demand by core-backend's POST /workspaces route instead,
# so it never needs to be added here.
COUCHDB_WORKSPACES="${COUCHDB_WORKSPACES:-band-a band-b}"
FRONTEND_ORIGIN="${FRONTEND_ORIGIN:-http://localhost:5173}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Gitignored (see .gitignore) - never a place to keep anything checked in. Re-running this
# script reuses a workspace's existing password from here rather than generating a new one,
# so tablets that already paired with it don't get silently locked out.
CREDENTIALS_FILE="${CREDENTIALS_FILE:-${SCRIPT_DIR}/../docker/couchdb-credentials.env}"

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

echo "Enabling CORS for ${FRONTEND_ORIGIN} ..."
curl -sk -X PUT -u "$AUTH" "${COUCHDB_URL}/_node/_local/_config/httpd/enable_cors" -d '"true"' > /dev/null
curl -sk -X PUT -u "$AUTH" "${COUCHDB_URL}/_node/_local/_config/cors/origins" -d "\"${FRONTEND_ORIGIN}\"" > /dev/null
curl -sk -X PUT -u "$AUTH" "${COUCHDB_URL}/_node/_local/_config/cors/credentials" -d '"true"' > /dev/null
curl -sk -X PUT -u "$AUTH" "${COUCHDB_URL}/_node/_local/_config/cors/methods" -d '"GET, PUT, POST, HEAD, DELETE"' > /dev/null
curl -sk -X PUT -u "$AUTH" "${COUCHDB_URL}/_node/_local/_config/cors/headers" \
  -d '"accept, authorization, content-type, origin, referer, x-csrf-token"' > /dev/null

touch "$CREDENTIALS_FILE"

# CouchDB's _security.admins are NOT automatically exempt from validate_doc_update (verified
# live against a real CouchDB instance - only a true server admin, userCtx.roles containing
# _admin, skips it), so this checks userCtx.name explicitly per workspace, matching
# core-backend's rosterValidationSource() (workspaceProvisioning.ts). One line: JSON strings
# can't contain a raw newline. Single-quoted JS string literals so this drops straight into a
# double-quoted JSON string below with no escaping needed - the admin username is a value this
# script itself generated (stageboard-<id>-admin), never external input.
roster_validate_fn() {
  local admin_username="$1"
  echo "function(newDoc, oldDoc, userCtx) { if (newDoc._id.indexOf('profiles:') === 0 && userCtx.name !== '${admin_username}') { throw({forbidden: 'Only the band admin may edit the roster.'}); } }"
}

# A 409 from a user PUT means the user already exists - matches core-backend's createUser()
# (couch.ts): never rotate an existing user's password.
create_couch_user() {
  local username="$1" password="$2"
  curl -sk -X PUT -u "$AUTH" -H "Content-Type: application/json" \
    "${COUCHDB_URL}/_users/org.couchdb.user:${username}" \
    -d "{\"_id\": \"org.couchdb.user:${username}\", \"name\": \"${username}\", \"password\": \"${password}\", \"roles\": [], \"type\": \"user\"}" \
    > /dev/null
}

for workspace_id in $COUCHDB_WORKSPACES; do
  db="stageboard-${workspace_id}"
  username="stageboard-${workspace_id}"
  admin_username="${username}-admin"
  var_prefix="COUCHDB_PW_$(echo "$workspace_id" | tr '[:lower:]-' '[:upper:]_')"

  password="$(grep -m1 "^${var_prefix}=" "$CREDENTIALS_FILE" | cut -d= -f2- || true)"
  if [ -z "$password" ]; then
    password="$(openssl rand -hex 24)"
    echo "${var_prefix}=${password}" >> "$CREDENTIALS_FILE"
  fi

  admin_password="$(grep -m1 "^${var_prefix}_ADMIN=" "$CREDENTIALS_FILE" | cut -d= -f2- || true)"
  if [ -z "$admin_password" ]; then
    admin_password="$(openssl rand -hex 24)"
    echo "${var_prefix}_ADMIN=${admin_password}" >> "$CREDENTIALS_FILE"
  fi

  echo "Provisioning workspace '${workspace_id}' (user '${username}', admin '${admin_username}', db '${db}') ..."

  create_couch_user "$username" "$password"
  create_couch_user "$admin_username" "$admin_password"

  status=$(curl -sk -o /dev/null -w '%{http_code}' -X PUT -u "$AUTH" "${COUCHDB_URL}/${db}")
  if [ "$status" != "201" ] && [ "$status" != "412" ]; then
    echo "Unexpected response creating database ${db}: HTTP $status" >&2
    exit 1
  fi

  curl -sk -X PUT -u "$AUTH" -H "Content-Type: application/json" \
    "${COUCHDB_URL}/${db}/_security" \
    -d "{\"admins\": {\"names\": [\"${admin_username}\"], \"roles\": []}, \"members\": {\"names\": [\"${username}\"], \"roles\": []}}" \
    > /dev/null

  # Fetch-then-PUT, not a bare create: unlike the users/db above, this is meant to be
  # re-deployable on every run (the validation logic itself can change during development,
  # not just be provisioned once) - a PUT without the current _rev would 409-and-silently-fail
  # against an existing doc instead of actually updating it.
  ddoc_rev=$(curl -sk -u "$AUTH" "${COUCHDB_URL}/${db}/_design/roster" | grep -o '"_rev":"[^"]*"' | head -1 | cut -d'"' -f4 || true)
  rev_field=""
  if [ -n "$ddoc_rev" ]; then
    rev_field=", \"_rev\": \"${ddoc_rev}\""
  fi
  curl -sk -X PUT -u "$AUTH" -H "Content-Type: application/json" \
    "${COUCHDB_URL}/${db}/_design/roster" \
    -d "{\"_id\": \"_design/roster\", \"validate_doc_update\": \"$(roster_validate_fn "$admin_username")\"${rev_field}}" \
    > /dev/null

  echo "  -> username: ${username}"
  echo "  -> password: ${password}"
  echo "  -> admin username: ${admin_username}"
  echo "  -> admin password: ${admin_password}"
done

echo "Done. Workspace credentials saved to ${CREDENTIALS_FILE} - enter a workspace's password"
echo "once in the PWA (WorkspaceSwitcher) when a device first syncs to it, like a Wi-Fi password."
