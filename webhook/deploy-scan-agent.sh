#!/bin/sh
set -e
echo "[$(date -Iseconds)] deploy-scan-agent: pulling dashboard..."
cd /opt/home-codespaces
docker compose pull dashboard
docker compose up -d --no-deps dashboard
echo "[$(date -Iseconds)] deploy-scan-agent: done"
