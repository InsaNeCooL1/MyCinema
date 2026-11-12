#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
LOG=~/prog/mcm-app.log
mkdir -p ~/prog
echo "=== APP BUILD: $(date) ===" > "$LOG"
exec > >(tee -a "$LOG") 2>&1

# Clean gradle
./android/gradlew --stop 2>/dev/null || true
pkill -f "GradleDaemon" 2>/dev/null || true
pkill -f "KotlinCompileDaemon" 2>/dev/null || true

# Assemble www/
rm -rf www
mkdir -p www/src
cp ../shared/src/*.js www/src/
cp src/*.js www/src/
cp index.html www/
cp styles.css www/
cp manifest.json www/ 2>/dev/null || true

# Syntax check
for f in www/src/*.js; do
    node --check "$f" || { echo "✗ $f"; exit 1; }
done
echo "✅ JS syntax OK"

# Sync
echo "🔄 cap sync android..."
npx cap sync android

# Build APK
echo "🔨 gradlew assembleDebug..."
cd android
./gradlew assembleDebug --no-daemon --max-workers=2
cd ..

# Install
cp android/app/build/outputs/apk/debug/app-debug.apk ~/prog/mcm.apk
if ! adb devices | grep -q "device$"; then
    adb connect 100.115.92.2:5555 || true
    sleep 2
fi
adb install -r ~/prog/mcm.apk || true

echo "🎉 APK: ~/prog/mcm.apk"
