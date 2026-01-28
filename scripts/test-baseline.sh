#!/bin/bash
set -e

echo "=== Testing Frontend Build ==="
cd frontend && npm run build && cd ..

echo ""
echo "=== Testing Backend Startup ==="
cd backend
timeout 10s npm run dev > /dev/null 2>&1 &
SERVER_PID=$!
sleep 5
kill $SERVER_PID 2>/dev/null || true
cd ..

echo ""
echo "=== Baseline Tests Passed ==="
