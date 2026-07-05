#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: $0 <app-path> <output-dmg>" >&2
  exit 64
fi

app_path="$1"
output_dmg="$2"
volume_name="MasterData Editor"
python_bin="${DMGBUILD_PYTHON:-python3}"

if [ ! -d "$app_path" ]; then
  echo "app bundle not found: $app_path" >&2
  exit 66
fi

workdir="$(mktemp -d)"
cleanup() {
  rm -rf "$workdir"
}
trap cleanup EXIT

settings="$workdir/dmgbuild.json"
"$python_bin" - "$settings" "$app_path" <<'PY'
import json
import os
import sys

settings_path = sys.argv[1]
app_path = os.path.abspath(sys.argv[2])
app_name = os.path.basename(app_path)

with open(settings_path, "w", encoding="utf-8") as file:
    json.dump(
        {
            "title": "MasterData Editor",
            "format": "UDZO",
            "filesystem": "HFS+",
            "background": "builtin-arrow",
            "icon-size": 128,
            "window": {
                "position": {"x": 120, "y": 120},
                "size": {"width": 660, "height": 400},
            },
            "contents": [
                {
                    "type": "file",
                    "path": app_path,
                    "name": app_name,
                    "x": 180,
                    "y": 170,
                },
                {
                    "type": "link",
                    "path": "/Applications",
                    "name": "Applications",
                    "x": 480,
                    "y": 170,
                },
            ],
        },
        file,
    )
PY

mkdir -p "$(dirname "$output_dmg")"
rm -f "$output_dmg"
"$python_bin" -m dmgbuild \
  --settings "$settings" \
  "$volume_name" \
  "$output_dmg"
