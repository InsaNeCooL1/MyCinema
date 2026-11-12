#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

if [ ! -f "index.html" ]; then
    echo "❌ web/index.html not found — web UI not built yet"
    exit 1
fi

rm -rf dist
mkdir -p dist/src
cp ../shared/src/*.js dist/src/
cp src/*.js dist/src/ 2>/dev/null || true
cp index.html dist/
cp styles.css dist/ 2>/dev/null || true
cp manifest.json dist/ 2>/dev/null || true

echo "✅ Web built to web/dist/"
echo "Test: cd dist && python3 -m http.server 8081"
