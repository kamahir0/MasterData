#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
APP_TARGET_DIR="$APP_ROOT/src-tauri/target/release/bundle/macos"

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

xattr -dr com.apple.quarantine "$APP_BUNDLE" 2>/dev/null || true
open "$APP_BUNDLE"

echo "Opened: $APP_BUNDLE"
