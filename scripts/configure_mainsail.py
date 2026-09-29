#!/usr/bin/env python3
"""Safely add or remove the Calibration Wizard from Mainsail's sidebar."""

from __future__ import annotations

import argparse
import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def load_navigation(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SystemExit(f"Cannot read valid Mainsail navigation JSON: {path}: {exc}") from exc
    if not isinstance(value, list) or not all(isinstance(item, dict) for item in value):
        raise SystemExit(f"Mainsail navigation must be a JSON array of objects: {path}")
    return value


def is_managed(item: dict[str, Any]) -> bool:
    return item.get("href", "").rstrip("/") == "/calibration"


def write_navigation(path: Path, navigation: list[dict[str, Any]]) -> Path | None:
    rendered = json.dumps(navigation, ensure_ascii=False, indent=2) + "\n"
    if path.exists() and path.read_text(encoding="utf-8") == rendered:
        return None

    path.parent.mkdir(parents=True, exist_ok=True)
    backup = None
    mode = 0o644
    if path.exists():
        mode = path.stat().st_mode & 0o777
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        backup = path.with_name(f"{path.name}.kcw-backup-{stamp}")
        backup.write_bytes(path.read_bytes())
        os.chmod(backup, mode)

    handle, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as stream:
            stream.write(rendered)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, mode)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)
    return backup


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--remove", action="store_true")
    parser.add_argument("navigation", type=Path)
    parser.add_argument("entry", type=Path, nargs="?")
    args = parser.parse_args()

    navigation = load_navigation(args.navigation)
    updated = [item for item in navigation if not is_managed(item)]
    if not args.remove:
        if args.entry is None:
            parser.error("entry is required when installing")
        try:
            entry = json.loads(args.entry.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise SystemExit(f"Cannot read sidebar entry: {args.entry}: {exc}") from exc
        if not isinstance(entry, dict) or not is_managed(entry):
            raise SystemExit("Sidebar entry must point to /calibration/")
        updated.append(entry)

    if updated == navigation:
        print("")
        return
    backup = write_navigation(args.navigation, updated)
    print(backup or "")


if __name__ == "__main__":
    main()
