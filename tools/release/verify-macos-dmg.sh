#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "usage: $0 <dmg-path>" >&2
  exit 64
fi

dmg_path="$1"

if [ ! -f "$dmg_path" ]; then
  echo "dmg not found: $dmg_path" >&2
  exit 66
fi

plist="$(hdiutil attach -readonly -nobrowse -plist "$dmg_path")"
mount_point="$(printf '%s' "$plist" | python3 -c '
import plistlib
import sys

plist = plistlib.loads(sys.stdin.buffer.read())
for entity in plist.get("system-entities", []):
    mount_point = entity.get("mount-point")
    if mount_point:
        print(mount_point, end="")
        break
')"

if [ -z "$mount_point" ]; then
  echo "could not determine mounted DMG volume" >&2
  exit 69
fi

cleanup() {
  hdiutil detach "$mount_point" >/dev/null || true
}
trap cleanup EXIT

test -d "$mount_point/MasterData Editor.app"
test -L "$mount_point/Applications"
test -f "$mount_point/.DS_Store"
test -f "$mount_point/.background.tiff"

if [ -e "$mount_point/.VolumeIcon.icns" ]; then
  echo ".VolumeIcon.icns must not be packaged" >&2
  exit 1
fi
