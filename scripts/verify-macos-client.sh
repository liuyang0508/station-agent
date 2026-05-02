#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="$ROOT_DIR/dist/macos/AIAgent Client.app"
DMG_PATH="$ROOT_DIR/dist/macos/AIAgent-Client-0.1.0-mac-arm64.dmg"
ZIP_PATH="$ROOT_DIR/dist/macos/AIAgent-Client-0.1.0-mac-arm64.zip"
NODE_PATH="$APP_DIR/Contents/Resources/runtime/bin/node"

test -d "$APP_DIR"
test -f "$DMG_PATH"
test -f "$ZIP_PATH"
test -x "$NODE_PATH"

"$NODE_PATH" -e "if (!process.execPath.includes('.app/Contents/Resources/runtime/bin/node')) process.exit(1)"
plutil -lint "$APP_DIR/Contents/Info.plist" >/dev/null
codesign --verify --deep --strict --verbose=2 "$APP_DIR" >/dev/null
hdiutil verify "$DMG_PATH" >/dev/null
npm test

echo "macOS client verification passed"
