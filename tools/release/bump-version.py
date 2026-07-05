#!/usr/bin/env python3
import argparse
import json
import re
from pathlib import Path
from typing import Dict, List, Optional, Tuple


VERSION_RE = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")


def bump_version(version: str, level: str) -> str:
    match = VERSION_RE.fullmatch(version)
    if not match:
        raise SystemExit(f"unsupported version format: {version}")

    major, minor, patch = (int(part) for part in match.groups())
    if level == "major":
        return f"{major + 1}.0.0"
    if level == "minor":
        return f"{major}.{minor + 1}.0"
    if level == "patch":
        return f"{major}.{minor}.{patch + 1}"
    raise SystemExit(f"unsupported bump level: {level}")


def workspace_version(repo: Path) -> str:
    path = repo / "Cargo.toml"
    in_workspace_package = False
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if stripped.startswith("[") and stripped.endswith("]"):
            in_workspace_package = stripped == "[workspace.package]"
            continue
        if not in_workspace_package:
            continue

        match = re.match(r'^version\s*=\s*"([^"]+)"', stripped)
        if match:
            return match.group(1)

    raise SystemExit(f"{path}: [workspace.package] version was not found")


def update_workspace_version(path: Path, old: str, new: str) -> None:
    lines = path.read_text(encoding="utf-8").splitlines(keepends=True)
    in_workspace_package = False
    found = False

    for index, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith("[") and stripped.endswith("]"):
            in_workspace_package = stripped == "[workspace.package]"
            continue
        if not in_workspace_package:
            continue

        if line.endswith("\r\n"):
            ending = "\r\n"
            body = line[:-2]
        elif line.endswith("\n"):
            ending = "\n"
            body = line[:-1]
        else:
            ending = ""
            body = line

        match = re.match(r'^(\s*version\s*=\s*")([^"]+)(".*)$', body)
        if not match:
            continue
        if match.group(2) != old:
            raise SystemExit(
                f"{path}: workspace package version is {match.group(2)}, expected {old}"
            )
        lines[index] = f"{match.group(1)}{new}{match.group(3)}{ending}"
        found = True
        break

    if not found:
        raise SystemExit(f"{path}: [workspace.package] version was not found")

    path.write_text("".join(lines), encoding="utf-8")


def update_json_versions(
    path: Path, old: str, new: str, expected_paths: List[Tuple[str, ...]]
) -> None:
    text = path.read_text(encoding="utf-8")
    data = json.loads(text)

    for key_path in expected_paths:
        value = data
        for key in key_path:
            value = value[key]
        if value != old:
            dotted = ".".join(key_path)
            raise SystemExit(f"{path}: {dotted} is {value}, expected {old}")

    old_literal = f'"version": "{old}"'
    new_literal = f'"version": "{new}"'
    if text.count(old_literal) < len(expected_paths):
        raise SystemExit(f"{path}: expected version literal was not found enough times")

    text = text.replace(old_literal, new_literal, len(expected_paths))
    updated = json.loads(text)
    for key_path in expected_paths:
        value = updated
        for key in key_path:
            value = value[key]
        if value != new:
            dotted = ".".join(key_path)
            raise SystemExit(f"{path}: failed to update {dotted}")

    path.write_text(text, encoding="utf-8")


def write_outputs(path: Optional[str], values: Dict[str, str]) -> None:
    for key, value in values.items():
        print(f"{key}={value}")

    if path:
        with open(path, "a", encoding="utf-8") as file:
            for key, value in values.items():
                file.write(f"{key}={value}\n")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("level", choices=["patch", "minor", "major"])
    parser.add_argument("--repo", type=Path, default=Path.cwd())
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--github-output")
    args = parser.parse_args()

    repo = args.repo.resolve()
    current = workspace_version(repo)
    next_version = bump_version(current, args.level)
    values = {
        "previous_version": current,
        "version": next_version,
        "tag": f"v{next_version}",
    }

    if not args.dry_run:
        update_workspace_version(repo / "Cargo.toml", current, next_version)
        update_json_versions(
            repo / "apps/editor/package.json",
            current,
            next_version,
            [("version",)],
        )
        update_json_versions(
            repo / "apps/editor/package-lock.json",
            current,
            next_version,
            [("version",), ("packages", "", "version")],
        )
        update_json_versions(
            repo / "apps/editor/src-tauri/tauri.conf.json",
            current,
            next_version,
            [("version",)],
        )

    write_outputs(args.github_output, values)


if __name__ == "__main__":
    main()
