#!/usr/bin/env bash
set -euo pipefail

APP_NAME="MasterData Editor Dev"
APP_IDENTIFIER="com.kamahir0.masterdata.editor.dev"

osascript -e "quit app \"$APP_NAME\"" >/dev/null 2>&1 || true

remove_path() {
  local path="$1"
  if [ ! -e "$path" ]; then
    return
  fi

  if [ -w "$path" ] && [ -w "$(dirname "$path")" ]; then
    rm -rf "$path"
  else
    sudo rm -rf "$path"
  fi
  echo "Removed: $path"
}

remove_path "/Applications/$APP_NAME.app"
remove_path "$HOME/Library/Application Support/$APP_IDENTIFIER"
remove_path "$HOME/Library/Caches/$APP_IDENTIFIER"
remove_path "$HOME/Library/HTTPStorages/$APP_IDENTIFIER"
remove_path "$HOME/Library/Preferences/$APP_IDENTIFIER"
remove_path "$HOME/Library/Preferences/$APP_IDENTIFIER.plist"
remove_path "$HOME/Library/Saved Application State/$APP_IDENTIFIER.savedState"
remove_path "$HOME/Library/WebKit/$APP_IDENTIFIER"

echo "Cleaned $APP_NAME development state."
