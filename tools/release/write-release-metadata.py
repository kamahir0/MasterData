#!/usr/bin/env python3
import argparse
import hashlib
import json
from collections import OrderedDict
from pathlib import Path


INIT_ASSETS = OrderedDict(
    [
        ("windows-x64", "MasterDataInit-windows-x64.exe"),
        ("osx-arm64", "MasterDataInit-osx-arm64"),
        ("osx-x64", "MasterDataInit-osx-x64"),
        ("linux-x64", "MasterDataInit-linux-x64"),
    ]
)

CONVERTER_ASSETS = OrderedDict(
    [
        ("windows-x64", "MasterDataConverter-windows-x64.exe"),
        ("osx-arm64", "MasterDataConverter-osx-arm64"),
        ("osx-x64", "MasterDataConverter-osx-x64"),
        ("linux-x64", "MasterDataConverter-linux-x64"),
    ]
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def asset_entry(dist: Path, file_name: str) -> dict[str, str]:
    path = dist / file_name
    if not path.is_file():
        raise SystemExit(f"missing release asset: {path}")
    return {"file": file_name, "sha256": sha256(path)}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("version", help="release version without leading v")
    parser.add_argument("dist", type=Path, help="directory containing release assets")
    args = parser.parse_args()

    dist = args.dist
    if not dist.is_dir():
        raise SystemExit(f"release asset directory does not exist: {dist}")

    for generated in (dist / "manifest.json", dist / "checksums.txt"):
        if generated.exists():
            generated.unlink()

    init = OrderedDict(
        (platform, asset_entry(dist, file_name))
        for platform, file_name in INIT_ASSETS.items()
    )
    converters = OrderedDict(
        (platform, asset_entry(dist, file_name))
        for platform, file_name in CONVERTER_ASSETS.items()
    )

    manifest = OrderedDict(
        [
            ("version", args.version),
            ("init", init),
            ("converters", converters),
        ]
    )
    (dist / "manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n",
        encoding="utf-8",
    )

    checksum_lines = []
    for assets in (init, converters):
        for asset in assets.values():
            checksum_lines.append(f"{asset['sha256']}  {asset['file']}")
    (dist / "checksums.txt").write_text(
        "\n".join(checksum_lines) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
