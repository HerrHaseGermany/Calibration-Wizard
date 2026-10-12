"""Inspect the deployed frontend and queue a restricted, unprivileged repair job."""

from __future__ import annotations

import fcntl
import hashlib
import json
import os
import tempfile
import time
from pathlib import Path

REVISION = 8
# Revision 8 only adds optional iframe width synchronization. Revision 7 has
# the same route, appearance bridge and navigation guards and remains usable.
COMPATIBLE_REVISIONS = {7, REVISION}
SUPPORTED = {"v2.19.0": "5fb9e77fb9f4e60cf0725d9dc7f57cf7b84bbd70"}
MANIFEST = ".kcw-tools.json"
QUEUE_TIMEOUT = 60


def migrate_state(source: Path, destination: Path) -> bool:
    """Move legacy build state out of config while retaining the original backup."""
    if source.resolve() == destination.resolve() or not source.exists():
        return False
    if source.is_symlink() or destination.exists() or destination.is_symlink():
        raise ValueError("Cannot migrate Mainsail state over an existing directory or symlink")
    previous = read_json(source / "last-backup.json")
    backup = Path(previous["path"]) if previous.get("path") else None
    if backup and backup.is_relative_to(source):
        previous["path"] = str(destination / backup.relative_to(source))
    destination.parent.mkdir(parents=True, exist_ok=True)
    source.rename(destination)
    try:
        if previous:
            write_json(destination / "last-backup.json", previous)
    except Exception:
        destination.rename(source)
        raise
    return True


def read_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text("utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def worker_running(state_dir: Path) -> bool:
    """Probe the worker's OS lock without creating or changing build state."""
    try:
        with (state_dir / "worker.lock").open("rb") as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_SH | fcntl.LOCK_NB)
            except BlockingIOError:
                return True
    except OSError:
        return False
    return False


class MainsailIntegration:
    def __init__(self, root: Path | None, state_dir: Path, enabled: bool = False):
        self.root = root
        self.state_dir = state_dir
        self.enabled = enabled

    def status(self) -> dict:
        version = read_json(self.root / "release_info.json").get("version") if self.root else None
        supported = isinstance(version, str) and version in SUPPORTED
        manifest = read_json(self.root / MANIFEST) if self.root else {}
        reason = "unsupported" if not supported else "missing"
        matching_version = bool(supported and manifest.get("version") == version)
        if matching_version and manifest.get("files"):
            reason = "changed"
        healthy = bool(matching_version and manifest.get("files"))
        if healthy:
            try:
                for name, expected in manifest["files"].items():
                    path = (self.root / name).resolve()
                    if not path.is_relative_to(self.root.resolve()) or digest(path) != expected:
                        healthy = False
                        break
            except (OSError, TypeError, AttributeError):
                healthy = False
        revision = manifest.get("revision")
        if healthy and (not isinstance(revision, int) or revision not in COMPATIBLE_REVISIONS):
            reason = "outdated"
            healthy = False
        elif healthy:
            reason = None
        running = worker_running(self.state_dir)
        job = read_json(self.state_dir / "status.json")
        pending = (self.state_dir / "request").exists()
        try:
            recent = 0 <= time.time() - float(job.get("updated", 0)) < QUEUE_TIMEOUT
        except (TypeError, ValueError):
            recent = False
        queued = pending and job.get("state") == "queued" and recent
        busy = running or queued
        job_state = job.get("state", "idle")
        if running:
            job_state = "building"
        elif not queued and job_state in {"building", "queued"}:
            # A killed worker cannot write its final status. Its lock is released
            # by the OS, so a leftover JSON record must not keep Repair disabled.
            job_state = "interrupted"
        return {
            "configured": self.root is not None,
            "healthy": healthy,
            "reason": reason,
            "revision": manifest.get("revision"),
            "latest_revision": REVISION,
            "compatible_revisions": sorted(COMPATIBLE_REVISIONS),
            "version": version,
            "supported": supported,
            "can_repair": self.enabled and supported and not healthy and not busy,
            "busy": busy,
            "job": job_state,
            "error": job.get("error"),
            "standalone_url": "/api/klipper-tools/",
        }

    def request_repair(self) -> None:
        if self.status()["busy"]:
            raise ValueError("Repair already queued or running")
        self.state_dir.mkdir(parents=True, exist_ok=True)
        request = self.state_dir / "request"
        if request.exists():
            # Only a stale job may be queued again; the worker also takes an OS lock.
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
