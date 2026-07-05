#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: $0 <input-dmg> <output-dmg>" >&2
  exit 64
fi

input_dmg="$1"
output_dmg="$2"

if [ ! -f "$input_dmg" ]; then
  echo "dmg not found: $input_dmg" >&2
  exit 66
fi

workdir="$(mktemp -d)"
mount_point=""

cleanup() {
  rm -rf "$workdir"
}

detach() {
  if [ -z "$mount_point" ]; then
    return
  fi

  for _ in 1 2 3 4 5; do
    if hdiutil detach "$mount_point" >/dev/null 2>&1; then
      mount_point=""
      return
    fi
    sleep 1
  done

  hdiutil detach -force "$mount_point" >/dev/null
  mount_point=""
}

trap 'detach; cleanup' EXIT

readwrite_dmg="$workdir/master-data-editor.rw.dmg"
hdiutil convert "$input_dmg" -format UDRW -o "$readwrite_dmg" >/dev/null

attach_plist="$(hdiutil attach \
  -readwrite \
  -nobrowse \
  -noautoopen \
  -plist \
  "$readwrite_dmg")"

mount_point="$(printf '%s' "$attach_plist" | python3 -c '
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

rm -f "$mount_point/.VolumeIcon.icns"
xattr -d com.apple.FinderInfo "$mount_point" >/dev/null 2>&1 || true
sync
detach

mkdir -p "$(dirname "$output_dmg")"
rm -f "$output_dmg"
hdiutil convert \
  "$readwrite_dmg" \
  -format UDZO \
  -imagekey zlib-level=9 \
  -o "$output_dmg" >/dev/null
