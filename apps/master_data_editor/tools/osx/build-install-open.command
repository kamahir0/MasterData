#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
WORKSPACE_ROOT="$(cd "$APP_ROOT/../.." && pwd)"
APP_TARGET_DIR="$WORKSPACE_ROOT/target/release/bundle/macos"

cd "$APP_ROOT"

if ! command -v npm >/dev/null 2>&1; then
  echo "npm was not found. Install Node.js before building the editor." >&2
  exit 1
fi

if ! command -v cargo >/dev/null 2>&1; then
  export PATH="/opt/homebrew/opt/rustup/bin:$PATH"
fi

if ! command -v cargo >/dev/null 2>&1; then
  echo "cargo was not found. Install Rust before building the editor." >&2
  exit 1
fi

if [ ! -d "$APP_ROOT/node_modules" ]; then
  npm install
fi

npm run tauri build

APP_BUNDLE="$(find "$APP_TARGET_DIR" -maxdepth 1 -name '*.app' -type d | sort | head -n 1)"
if [ -z "$APP_BUNDLE" ]; then
  echo "Built .app bundle was not found under $APP_TARGET_DIR" >&2
  exit 1
fi

DESTINATION="/Applications/$(basename "$APP_BUNDLE")"

if [ -w "/Applications" ]; then
  if [ -e "$DESTINATION" ]; then
    rm -rf "$DESTINATION"
  fi
  ditto "$APP_BUNDLE" "$DESTINATION"
  xattr -dr com.apple.quarantine "$DESTINATION" 2>/dev/null || true
else
  echo "Installing to /Applications requires administrator permission."
  if [ -e "$DESTINATION" ]; then
    sudo rm -rf "$DESTINATION"
  fi
  sudo ditto "$APP_BUNDLE" "$DESTINATION"
  sudo xattr -dr com.apple.quarantine "$DESTINATION" 2>/dev/null || true
fi

if [ -w "$DESTINATION" ] && [ -w "$DESTINATION/Contents/Info.plist" ]; then
  touch "$DESTINATION"
  touch "$DESTINATION/Contents/Info.plist"
else
  sudo touch "$DESTINATION"
  sudo touch "$DESTINATION/Contents/Info.plist"
fi
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
if [ -x "$LSREGISTER" ]; then
  "$LSREGISTER" -f "$DESTINATION" 2>/dev/null || true
fi

open "$DESTINATION"

echo "Installed and opened: $DESTINATION"
