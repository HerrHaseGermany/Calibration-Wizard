"""Inspect the deployed frontend and queue a restricted, unprivileged repair job."""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
import time
from pathlib import Path

REVISION = 2
SUPPORTED = {"v2.19.0": "5fb9e77fb9f4e60cf0725d9dc7f57cf7b84bbd70"}
MANIFEST = ".kcw-tools.json"


def read_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text("utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class MainsailIntegration:
    def __init__(self, root: Path | None, state_dir: Path, enabled: bool = False):
        self.root = root
        self.state_dir = state_dir
        self.enabled = enabled

    def status(self) -> dict:
        version = read_json(self.root / "release_info.json").get("version") if self.root else None
        supported = isinstance(version, str) and version in SUPPORTED
        manifest = read_json(self.root / MANIFEST) if self.root else {}
        healthy = bool(
            supported
            and manifest.get("version") == version
            and manifest.get("revision") == REVISION
            and manifest.get("files")
        )
        if healthy:
            try:
                for name, expected in manifest["files"].items():
                    path = (self.root / name).resolve()
                    if not path.is_relative_to(self.root.resolve()) or digest(path) != expected:
                        healthy = False
                        break
            except (OSError, TypeError, AttributeError):
                healthy = False
        job = read_json(self.state_dir / "status.json")
        pending = (self.state_dir / "request").exists()
        try:
            recent = time.time() - float(job.get("updated", 0)) < 3600
        except (TypeError, ValueError):
            recent = False
        busy = recent and (pending or job.get("state") == "building")
        return {
            "configured": self.root is not None,
            "healthy": healthy,
            "version": version,
            "supported": supported,
            "can_repair": self.enabled and supported and not healthy and not busy,
            "busy": busy,
            "job": job.get("state", "idle"),
            "error": job.get("error"),
            "standalone_url": "/api/klipper-tools/",
        }

    def request_repair(self) -> None:
        self.state_dir.mkdir(parents=True, exist_ok=True)
        request = self.state_dir / "request"
        if request.exists():
            # Only a stale job may be queued again; the worker also takes an OS lock.
            if self.status()["busy"]:
                raise ValueError("Repair already queued")
            request.unlink()
        write_json(self.state_dir / "status.json", {"state": "queued", "updated": time.time()})
        request.touch(exist_ok=False)


def write_json(path: Path, value: dict) -> None:
    handle, name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as stream:
            stream.write(json.dumps(value, indent=2) + "\n")
            stream.flush()
            os.fsync(stream.fileno())
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)
