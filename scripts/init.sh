#!/bin/bash
# Station Agent Bootstrap - Startup Health Checks
# 确保所有依赖就绪，必要时初始化状态

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DATA_DIR="$PROJECT_ROOT/data"
STORE_FILE="$DATA_DIR/station.json"

# ANSI colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log() { echo -e "${BLUE}[bootstrap]${NC} $1"; }
ok()  { echo -e "${GREEN}✓${NC} $1"; }
warn(){ echo -e "${YELLOW}⚠${NC} $1"; }
err() { echo -e "${RED}✗${NC} $1"; }

echo ""
echo "========================================="
echo "  Station Agent Bootstrap"
echo "========================================="
echo ""

# 1. Port check
log "Checking server port..."
if curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:47891/api/health 2>/dev/null | grep -q "200"; then
    ok "Server already running on :47891"
else
    warn "Server not running — run 'npm start' to launch"
fi

# 2. Data directory
log "Checking data directory..."
if [ -d "$DATA_DIR" ]; then
    ok "Data directory exists: $DATA_DIR"
else
    log "Creating data directory..."
    mkdir -p "$DATA_DIR"
    ok "Data directory created"
fi

# 3. Store file / SQLite
log "Checking store..."
DB_FILE="$DATA_DIR/station.db"
JSON_FILE="$STORE_FILE"
if [ -f "$DB_FILE" ]; then
    ok "SQLite store ready: $DB_FILE"
elif [ -f "$JSON_FILE" ]; then
    warn "Legacy JSON store found — consider migrating to SQLite"
    ok "JSON store present: $JSON_FILE"
else
    warn "No store found — server will initialize on first start"
fi

# 4. Python runtime
log "Checking Python runtime..."
if python3 -c "from agent_core import main; print('ok')" 2>/dev/null | grep -q "ok"; then
    ok "Python runtime available"
elif python3 -c "import sys; sys.path.insert(0, '$PROJECT_ROOT/python'); from agent_core import main" 2>/dev/null | grep -q "ok"; then
    ok "Python runtime available (via python/)"
else
    warn "Python runtime not available — Python skills disabled"
fi

# 5. Node modules
log "Checking Node modules..."
if [ -f "$PROJECT_ROOT/node_modules/.package-lock.json" ] || [ -d "$PROJECT_ROOT/node_modules" ]; then
    ok "Node modules installed"
else
    warn "Node modules not installed — run 'npm install'"
fi

# 6. MCP servers configured
log "Checking MCP servers..."
SERVER_CONFIGURED=true
if [ -f "$JSON_FILE" ]; then
    if grep -q '"mcp_servers"' "$JSON_FILE" 2>/dev/null; then
        COUNT=$(grep -o '"mcp_servers"' "$JSON_FILE" | wc -l)
        if [ "$COUNT" -gt 0 ]; then
            ok "MCP servers configured"
            SERVER_CONFIGURED=true
        else
            warn "No MCP servers configured"
            SERVER_CONFIGURED=false
        fi
    else
        warn "MCP server list empty"
        SERVER_CONFIGURED=false
    fi
else
    warn "Cannot check MCP config (no store)"
    SERVER_CONFIGURED=false
fi

# 7. Session handoff
log "Checking session handoff..."
HANDOFF_FILE="$DATA_DIR/session-handoff.json"
if [ -f "$HANDOFF_FILE" ]; then
    GOAL=$(python3 -c "import json; d=json.load(open('$HANDOFF_FILE')); print(d.get('goal','unknown'))" 2>/dev/null || echo "unknown")
    ok "Resumable session found: $GOAL"
else
    ok "Fresh session"
fi

# 8. Checkpoints from last session
log "Checking last session checkpoints..."
CP_FILE="$DATA_DIR/checkpoints.json"
if [ -f "$CP_FILE" ]; then
    LAST_GOAL=$(python3 -c "import json; d=json.load(open('$CP_FILE')); print(d[-1].get('label','no-label') if d else 'none')" 2>/dev/null || echo "unknown")
    ok "Previous checkpoints available (last: $LAST_GOAL)"
else
    ok "No previous checkpoints"
fi

# 9. Build check (macOS client)
log "Checking macOS client build..."
if [ -f "$PROJECT_ROOT/dist/Station Agent.app" ]; then
    ok "macOS app built: dist/Station Agent.app"
elif [ -d "$PROJECT_ROOT/.build" ]; then
    ok "Build artifacts present in .build/"
else
    warn "No built macOS app found — run 'npm run build:mac' if needed"
fi

echo ""
echo "========================================="
echo -e "  Bootstrap ${GREEN}complete${NC}"
echo "========================================="
echo ""
echo "Next steps:"
echo "  npm start          # Start server"
echo "  npm run dev        # Start in dev mode"
echo "  npm run build:mac  # Build macOS client"
echo ""
