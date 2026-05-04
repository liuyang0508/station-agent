#!/bin/bash
# Test script for Python Agent Core sidecar

SIDE_PID=''
cleanup() {
  [ -n "$SIDE_PID" ] && kill $SIDE_PID 2>/dev/null
}
trap cleanup EXIT

echo "=== Starting Python Agent Core sidecar ==="
npm run python:sidecar &
SIDE_PID=$!
sleep 2

echo ""
echo "=== Test 1: Load demo skill ==="
printf '{"jsonrpc":"2.0","id":1,"method":"skill.load","params":{"path":"python/skills/demo_skill.py"}}\n'
sleep 1

echo ""
echo "=== Test 2: Run demo skill ==="
printf '{"jsonrpc":"2.0","id":2,"method":"skill.run","params":{"name":"demo","context":{"task":"World"}}}\n'
sleep 1

echo ""
echo "=== Test 3: List skills ==="
printf '{"jsonrpc":"2.0","id":3,"method":"skill.list","params":{}}\n'
sleep 1

echo ""
echo "=== Test 4: Store memory ==="
printf '{"jsonrpc":"2.0","id":4,"method":"memory.store","params":{"content":"Python sidecar integration test","metadata":{"source":"test"}}}}\n'
sleep 1

echo ""
echo "=== Test 5: List memories ==="
printf '{"jsonrpc":"2.0","id":5,"method":"memory.list","params":{}}\n'
sleep 1

echo ""
echo "=== Test 6: Exec code ==="
printf '{"jsonrpc":"2.0","id":6,"method":"exec.run","params":{"code":"print(sum(range(1, 101)))"}}\n'
sleep 1

echo ""
echo "=== All tests sent ==="
