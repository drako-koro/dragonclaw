#!/bin/bash
# ═══════════════════════════════════════════════════════════
# DragonClaw Quick Runner (Non-Docker)
# Copies latest code from shared folder, installs deps, starts.
# Usage: bash ~/dragonclaw/scripts/run.sh
#   or:  bash /media/sf_dragonclaw-transfer/dragonclaw/scripts/run.sh
# ═══════════════════════════════════════════════════════════

set -e

echo ""
echo "  ✍️  DragonClaw Quick Runner"
echo "  ═══════════════════════════════════"
echo ""

# ── Resolve project root ──
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# If running from shared folder, copy first
SHARED="/media/sf_dragonclaw-transfer/dragonclaw"
HOME_DIR="$HOME/dragonclaw"

if [ -d "$SHARED" ]; then
  echo "  [1/5] Syncing code from shared folder..."
  rsync -a --delete \
    --exclude 'node_modules' \
    --exclude '.env' \
    --exclude 'workspace' \
    --exclude 'config/.vault' \
    --exclude 'config/user.json' \
    --exclude 'logs' \
    "$SHARED/" "$HOME_DIR/"
  echo "  ✓ Code synced"
else
  echo "  [1/5] No shared folder found, using local code"
fi

# Also copy premium skills if available
PREMIUM="/media/sf_dragonclaw-transfer/dragonclaw-premium"
if [ -d "$PREMIUM" ]; then
  echo "  ✓ Syncing premium skills..."
  rsync -a "$PREMIUM/" "$HOME_DIR/skills/premium/" 2>/dev/null || true
fi

PROJECT_DIR="$HOME_DIR"
cd "$PROJECT_DIR"

# ── Stop any existing DragonClaw processes ──
echo "  [2/5] Stopping old instances..."
pkill -f "tsx gateway/src/index.ts" 2>/dev/null && echo "  ✓ Old process killed" || echo "  ✓ No old process running"
sleep 1

# ── Install / update dependencies ──
echo "  [3/5] Checking dependencies..."
if [ ! -d "node_modules" ] || [ "package.json" -nt "node_modules/.package-lock.json" ]; then
  npm install --silent 2>&1 | tail -3
  echo "  ✓ Dependencies updated"
else
  echo "  ✓ Dependencies up to date"
fi

# ── Create required directories ──
mkdir -p workspace/audio workspace/.config workspace/memory workspace/projects workspace/research
mkdir -p logs

# ── Start DragonClaw (background, logs to file) ──
echo "  [4/5] Starting DragonClaw..."
LOG_FILE="$PROJECT_DIR/logs/dragonclaw-$(date +%Y%m%d-%H%M%S).log"
nohup npx tsx gateway/src/index.ts > "$LOG_FILE" 2>&1 &
AC_PID=$!
echo "  ✓ Started (PID: $AC_PID, log: $LOG_FILE)"

# ── Wait for health ──
echo "  [5/5] Waiting for health check..."
RETRIES=0
MAX_RETRIES=30
while [ $RETRIES -lt $MAX_RETRIES ]; do
  if curl -sf http://localhost:3847/api/health > /dev/null 2>&1; then
    echo ""
    echo "  ═══════════════════════════════════"
    echo "  ✅ DragonClaw is running!"
    echo ""
    echo "  📡 Dashboard: http://localhost:3847"
    echo "  📱 Telegram:  Working (if configured)"
    echo "  📝 Log file:  $LOG_FILE"
    echo ""
    echo "  View log:   tail -f $LOG_FILE"
    echo "  Stop:       pkill -f 'tsx gateway/src/index.ts'"
    echo "  ═══════════════════════════════════"

    # Show TTS detection status from log
    sleep 2
    echo ""
    echo "  TTS status:"
    grep -i "tts\|piper\|ffmpeg" "$LOG_FILE" 2>/dev/null || echo "  (checking...)"
    echo ""
    exit 0
  fi
  RETRIES=$((RETRIES + 1))
  sleep 2
  printf "  ."
done

echo ""
echo "  ⚠️  Health check timed out. Check log:"
echo "  tail -50 $LOG_FILE"
echo ""
# Show last 20 lines for debugging
tail -20 "$LOG_FILE"
exit 1
