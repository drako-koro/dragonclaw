#!/bin/bash
# ═══════════════════════════════════════════════════════════
# DragonClaw Docker Deployment Script
# Run this INSIDE the VM from ~/dragonclaw/
# ═══════════════════════════════════════════════════════════

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

echo ""
echo "  ✍️  DragonClaw Docker Deploy"
echo "  ═══════════════════════════════════════"
echo ""

# ── Pre-flight checks ──
if ! command -v docker &> /dev/null; then
    echo "  ✗ Docker not found. Run vm-setup.sh first."
    exit 1
fi

if ! docker info &> /dev/null 2>&1; then
    echo "  ✗ Docker daemon not running or user not in docker group."
    echo "    Try: sudo systemctl start docker"
    echo "    Or:  newgrp docker"
    exit 1
fi

# ── Check for vault key ──
if [ -z "$DRAGONCLAW_VAULT_KEY" ]; then
    echo "  ⚠ DRAGONCLAW_VAULT_KEY not set."
    echo "    Generating a random vault key for this deployment."
    echo "    To persist vault data across deploys, set it explicitly:"
    echo "    export DRAGONCLAW_VAULT_KEY='your-secure-passphrase'"
    echo ""
    DRAGONCLAW_VAULT_KEY=$(openssl rand -hex 32)
fi

# ── Create .env for docker-compose ──
echo "  [1/4] Creating environment file..."
cat > docker/.env << EOF
DRAGONCLAW_VAULT_KEY=${DRAGONCLAW_VAULT_KEY}
AUTHOR_OS_PATH=${AUTHOR_OS_PATH:-$HOME/author-os}
EOF
echo "  ✓ Environment file created"

# ── Build the image ──
echo "  [2/4] Building DragonClaw Docker image..."
docker compose -f docker/docker-compose.yml build
echo "  ✓ Image built"

# ── Start services ──
echo "  [3/4] Starting DragonClaw..."
docker compose -f docker/docker-compose.yml up -d
echo "  ✓ Services started"

# ── Wait for health check ──
echo "  [4/4] Waiting for health check..."
RETRIES=0
MAX_RETRIES=30
while [ $RETRIES -lt $MAX_RETRIES ]; do
    if curl -sf http://localhost:3847/api/health > /dev/null 2>&1; then
        echo "  ✓ DragonClaw is healthy!"
        break
    fi
    RETRIES=$((RETRIES + 1))
    sleep 2
done

if [ $RETRIES -eq $MAX_RETRIES ]; then
    echo "  ⚠ Health check didn't pass. Check logs:"
    echo "    docker compose -f docker/docker-compose.yml logs"
fi

echo ""
echo "  ═══════════════════════════════════════"
echo "  ✍️  DragonClaw is running!"
echo "  📡 Dashboard: http://localhost:3847"
echo ""
echo "  Useful commands:"
echo "    Logs:    docker compose -f docker/docker-compose.yml logs -f"
echo "    Stop:    docker compose -f docker/docker-compose.yml down"
echo "    Restart: docker compose -f docker/docker-compose.yml restart"
echo "  ═══════════════════════════════════════"
echo ""
