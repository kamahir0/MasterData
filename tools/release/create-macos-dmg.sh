#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: $0 <app-path> <output-dmg>" >&2
  exit 64
fi

app_path="$1"
output_dmg="$2"
volume_name="MasterData Editor"

if [ ! -d "$app_path" ]; then
  echo "app bundle not found: $app_path" >&2
  exit 66
fi

workdir="$(mktemp -d)"
cleanup() {
  rm -rf "$workdir"
}
trap cleanup EXIT

stage="$workdir/dmg-root"
mkdir -p "$stage"
cp -R "$app_path" "$stage/"
ln -s /Applications "$stage/Applications"

find "$stage" -name ".DS_Store" -delete

mkdir -p "$(dirname "$output_dmg")"
rm -f "$output_dmg"
hdiutil create \
  -volname "$volume_name" \
  -srcfolder "$stage" \
  -ov \
  -format UDZO \
  "$output_dmg"
