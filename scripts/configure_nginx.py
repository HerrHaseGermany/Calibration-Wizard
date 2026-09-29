#!/usr/bin/env python3
from __future__ import annotations

import argparse
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

BEGIN = "    # BEGIN klipper-calibration-wizard"
END = "    # END klipper-calibration-wizard"


def remove_block(text: str) -> str:
    start = text.find(BEGIN)
    if start < 0:
        return text
    end = text.find(END, start)
    if end < 0:
        raise ValueError("Found an incomplete Calibration Wizard nginx block")
    end = text.find("\n", end)
    return text[:start].rstrip() + "\n" + (text[end + 1 :] if end >= 0 else "")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("target", type=Path)
    parser.add_argument("snippet", type=Path)
    parser.add_argument("--remove", action="store_true")
    args = parser.parse_args()
    if not args.target.is_file():
        print(f"nginx site not found: {args.target}", file=sys.stderr)
        return 2
    original = args.target.read_text(encoding="utf-8")
    updated = remove_block(original)
    if not args.remove:
        closing = updated.rfind("}")
        if closing < 0:
            print("nginx site contains no server closing brace", file=sys.stderr)
            return 2
        snippet = args.snippet.read_text(encoding="utf-8").rstrip() + "\n"
        updated = updated[:closing].rstrip() + "\n\n" + snippet + updated[closing:]
    if updated == original:
        return 0
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = args.target.with_name(f"{args.target.name}.kcw-backup-{stamp}")
    shutil.copy2(args.target, backup)
    args.target.write_text(updated, encoding="utf-8")
    print(backup)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
