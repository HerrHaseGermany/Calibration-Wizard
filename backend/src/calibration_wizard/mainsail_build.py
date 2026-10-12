"""Build the exact supported upstream release and deploy with rollback, as the printer user."""

from __future__ import annotations

import argparse
import fcntl
import json
import os
import shutil
import subprocess
import tempfile
import time
from pathlib import Path
from urllib.request import Request, urlopen

from .mainsail_integration import (
    MANIFEST,
    REVISION,
    SUPPORTED,
    MainsailIntegration,
    digest,
    read_json,
    write_json,
)


def replace_once(path: Path, old: str, new: str) -> None:
    content = path.read_text("utf-8")
    if content.count(old) != 1:
        raise ValueError(f"Upstream layout does not match the checked patch: {path.name}")
    path.write_text(content.replace(old, new), encoding="utf-8")


def patch_source(source: Path, template: Path) -> None:
    version = "v" + read_json(source / "package.json").get("version", "")
    if version not in SUPPORTED:
        raise ValueError("Unsupported Mainsail release")
    shutil.copyfile(template, source / "src/pages/Tools.vue")
    routes = source / "src/routes/index.ts"
    replace_once(
        routes,
        "const routes: AppRoute[] = [",
        """const routes: AppRoute[] = [
    {
        name: 'tools', title: 'Tools', path: '/tools/', icon: mdiWrench,
        component: () => import('../pages/Tools.vue'), alwaysShow: true,
        showInNavi: true, position: 45, fullscreen: true,
    },""",
    )
    for locale in (source / "src/locales").glob("*.json"):
        values = read_json(locale)
        if "Router" in values:
            values["Router"]["Tools"] = "Tools"
            locale.write_text(json.dumps(values, ensure_ascii=False, indent=4) + "\n", "utf-8")
    replace_once(
        source / "vite.config.ts",
        "navigateFallbackDenylist: [",
        "navigateFallbackDenylist: [/^\\/tools(?:\\/|$)/, ",
    )


def require_idle() -> None:
    base = os.getenv("KCW_MOONRAKER_URL", "http://127.0.0.1:7125").rstrip("/")
    headers = {}
    if key := os.getenv("KCW_MOONRAKER_API_KEY"):
        headers["X-Api-Key"] = key
    for endpoint in ("/server/info", "/printer/objects/query?print_stats"):
        with urlopen(Request(base + endpoint, headers=headers), timeout=10) as response:
            result = json.load(response)["result"]
        if endpoint == "/server/info" and result.get("klippy_state") != "ready":
            raise ValueError("Klipper must be ready before deploying the frontend")
        if endpoint != "/server/info" and result["status"]["print_stats"]["state"] in {
            "printing",
            "paused",
        }:
            raise ValueError("Finish the print before repairing Mainsail")
    port = int(os.getenv("KCW_PORT", "7130"))
    with urlopen(f"http://127.0.0.1:{port}/api/status", timeout=10) as response:
        if not json.load(response).get("integration_idle"):
            raise ValueError("Finish active Tools actions before repairing Mainsail")


def deploy(build: Path, target: Path, state: Path, version: str) -> None:
    if not (build / "index.html").is_file() or not (build / "sw.js").is_file():
        raise ValueError("Mainsail build is incomplete")
    if read_json(target / "release_info.json").get("version") != version:
        raise ValueError("Mainsail changed during the build; no files were deployed")
    backup = state / "backups" / str(time.time_ns())
    backup.mkdir(parents=True)
    # Keep printer-specific config and custom files. Only replace files in this build.
    names = [str(path.relative_to(build)) for path in build.rglob("*") if path.is_file()]
    names = [name for name in names if name not in {"config.json", "mainsail.zip"}]
    previous = []
    for name in [*names, MANIFEST]:
        path = target / name
        if path.exists():
            if path.is_symlink() or not path.is_file():
                raise ValueError(f"Refusing to replace a symlink or non-file: {name}")
            saved = backup / name
            saved.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, saved)
            previous.append(name)
        if not (target / name).resolve().is_relative_to(target.resolve()):
            raise ValueError("Frontend file escapes the configured root")
    write_json(backup / "restore.json", {"files": names, "previous": previous})
    # Publish assets before index and service worker, keeping the old UI available.
    names.sort(key=lambda name: (name in {"index.html", "sw.js"}, name))
    try:
        for name in names:
            destination = target / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            temporary = destination.with_name(destination.name + ".kcw-tmp")
            try:
                shutil.copy2(build / name, temporary)
                temporary.replace(destination)
            finally:
                temporary.unlink(missing_ok=True)
        write_json(
            target / MANIFEST,
            {
                "revision": REVISION,
                "version": version,
                "files": {name: digest(target / name) for name in names},
            },
        )
        previous = read_json(state / "last-backup.json")
        if previous.get("version") != version:
            write_json(state / "last-backup.json", {"path": str(backup), "version": version})
    except Exception:
        restore(target, backup)
        raise


def restore(target: Path, backup: Path) -> None:
    data = read_json(backup / "restore.json")
    for name in [*data["files"], MANIFEST]:
        destination = target / name
        if not destination.resolve().is_relative_to(target.resolve()):
            raise ValueError("Invalid restore path")
        if name in data["previous"]:
            shutil.copy2(backup / name, destination)
        else:
            destination.unlink(missing_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--state", type=Path, required=True)
    parser.add_argument("--template", type=Path, required=True)
    parser.add_argument("--restore", action="store_true")
    args = parser.parse_args()
    args.state.mkdir(parents=True, exist_ok=True)
    with (args.state / "worker.lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.restore:
            previous = read_json(args.state / "last-backup.json")
            # An upstream update must never be rolled back by the uninstaller.
            healthy = MainsailIntegration(args.root, args.state).status()["healthy"]
            if (
                previous
                and healthy
                and read_json(args.root / "release_info.json").get("version") == previous["version"]
            ):
                restore(args.root, Path(previous["path"]))
            return
        try:
            write_json(args.state / "status.json", {"state": "building", "updated": time.time()})
            version = read_json(args.root / "release_info.json").get("version")
            if version not in SUPPORTED:
                raise ValueError(f"Mainsail {version!r} has no checked integration patch")
            require_idle()
            with tempfile.TemporaryDirectory(prefix="build-", dir=args.state) as temporary:
                source = Path(temporary)
                subprocess.run(
                    [
                        "git",
                        "clone",
                        "--quiet",
                        "--depth",
                        "1",
                        "--branch",
                        version,
                        "https://github.com/mainsail-crew/mainsail.git",
                        str(source),
                    ],
                    check=True,
                    timeout=180,
                )
                commit = subprocess.check_output(
                    ["git", "rev-parse", "HEAD"], cwd=source, text=True
                ).strip()
                if commit != SUPPORTED[version]:
                    raise ValueError("Upstream tag differs from the checked commit")
                patch_source(source, args.template)
                env = {**os.environ, "CYPRESS_INSTALL_BINARY": "0"}
                subprocess.run(
                    ["npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"],
                    cwd=source,
                    env=env,
                    check=True,
                    timeout=1200,
                )
                subprocess.run(
                    ["npm", "run", "build"], cwd=source, env=env, check=True, timeout=1200
                )
                require_idle()
                deploy(source / "dist", args.root, args.state, version)
            write_json(args.state / "status.json", {"state": "complete", "updated": time.time()})
        except Exception as exc:
            write_json(
                args.state / "status.json",
                {
                    "state": "failed",
                    "updated": time.time(),
                    "error": str(exc),
                },
            )
            raise
        finally:
            (args.state / "request").unlink(missing_ok=True)


if __name__ == "__main__":
    main()
