#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "$0")/.." && pwd)"
cert_dir="$root_dir/.certs"
mkdir -p "$cert_dir"

openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout "$cert_dir/localhost-key.pem" \
  -out "$cert_dir/localhost-cert.pem" \
  -days 365 \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"

echo "Created local HTTPS certificate files in $cert_dir"
