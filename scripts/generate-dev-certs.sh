#!/usr/bin/env bash
# Generates one self-signed TLS cert/key pair, shared by Vite, Fastify, and CouchDB - all
# three need to present the same origin (localhost, and optionally a LAN IP for tablets) as
# a secure context so getUserMedia()/WebMIDI work, without a real CA (docs/02: "Zero-Friction
# Stage Requirement", offline routers can't renew Let's Encrypt certs anyway).
#
# Safe to re-run: skips generation if certs/ already has both files, unless FORCE=1.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CERTS_DIR="${SCRIPT_DIR}/../certs"
CERT_FILE="${CERTS_DIR}/dev-cert.pem"
KEY_FILE="${CERTS_DIR}/dev-key.pem"

if [ -f "$CERT_FILE" ] && [ -f "$KEY_FILE" ] && [ "${FORCE:-0}" != "1" ]; then
  echo "Certs already exist at ${CERTS_DIR} (set FORCE=1 to regenerate)."
  exit 0
fi

mkdir -p "$CERTS_DIR"

# LAN_IP: same convention as scripts/setup-couchdb.sh's FRONTEND_ORIGIN - set it to the
# Stage-Server's LAN address so tablets trust the same cert the dev machine does.
SAN="subjectAltName=DNS:localhost,IP:127.0.0.1"
if [ -n "${LAN_IP:-}" ]; then
  SAN="${SAN},IP:${LAN_IP}"
fi

echo "Generating self-signed dev cert (SAN: ${SAN}) ..."
# Writes to temp names, then renames over the final ones - not in place. CouchDB's
# container entrypoint chowns everything under its bind-mounted /opt/couchdb tree
# (including this shared certs/ dir) to its own container user, on the *host* files too.
# A plain overwrite would need write permission on the existing file, which that leaves
# this script without; rename() only needs write+execute on the directory, which it still
# has - so regenerating (FORCE=1) keeps working regardless of who owns the previous certs.
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout "${KEY_FILE}.tmp" -out "${CERT_FILE}.tmp" \
  -days 825 \
  -subj "/CN=stageboard-dev" \
  -addext "$SAN"
mv -f "${CERT_FILE}.tmp" "$CERT_FILE"
mv -f "${KEY_FILE}.tmp" "$KEY_FILE"
# openssl defaults the key to 600 (owner-only) - CouchDB's container runs as its own
# uid (docker-compose.yml's `user: "5984:5984"`, not whoever runs this script), so it
# needs group/other read too. Not a real secret: dev-only, self-signed, never leaves
# this machine's shared services.
chmod 644 "$KEY_FILE"

echo "Wrote ${CERT_FILE} and ${KEY_FILE}."
echo "Each tablet needs one manual 'Proceed to site' tap on first visit (self-signed, no CA)."
