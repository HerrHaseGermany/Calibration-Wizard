from __future__ import annotations

import fcntl
import json
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from pathlib import Path
from threading import Event
from types import SimpleNamespace

import pytest
from calibration_wizard.api import create_app
from calibration_wizard.mainsail_build import acquire_worker_lock, deploy, patch_source, restore
from calibration_wizard.mainsail_integration import (
    COMPATIBLE_REVISIONS,
    MANIFEST,
    QUEUE_TIMEOUT,
    REVISION,
    MainsailIntegration,
    migrate_state,
    write_json,
)
from calibration_wizard.printer import MockPrinter
from calibration_wizard.settings import Settings
from fastapi.testclient import TestClient


def fixture(tmp_path):
    target = tmp_path / "mainsail"
    state = tmp_path / "state"
    build = tmp_path / "build"
    for path in (target, state, build):
        path.mkdir()
    info = json.dumps({"version": "v2.19.0"})
    for path in (target, build):
        (path / "release_info.json").write_text(info)
    (target / "index.html").write_text("original")
    (target / "sw.js").write_text("original service worker")
    (target / "config.json").write_text('{"hostname":"custom"}')
    (build / "index.html").write_text("patched")
    (build / "sw.js").write_text("patched service worker")
    (build / "config.json").write_text("defaults")
    (build / "assets").mkdir()
    (build / "assets/tools.js").write_text("tools")
    return target, state, build


def test_detects_overwrite_and_missing_assets_and_preserves_config(tmp_path):
    target, state, build = fixture(tmp_path)
    integration = MainsailIntegration(target, state, True)
    assert integration.status()["can_repair"]
    deploy(build, target, state, "v2.19.0")
    assert integration.status()["healthy"]
    assert integration.status()["reason"] is None
    assert json.loads((target / "config.json").read_text())["hostname"] == "custom"
    (target / "index.html").write_text("overwritten")
    assert integration.status()["can_repair"]
    assert integration.status()["reason"] == "changed"
    deploy(build, target, state, "v2.19.0")
    (target / "assets/tools.js").unlink()
    assert not integration.status()["healthy"]


def test_unsupported_version_cannot_be_repaired(tmp_path):
    target, state, _ = fixture(tmp_path)
    (target / "release_info.json").write_text('{"version":"v99.0.0"}')
    current = MainsailIntegration(target, state, True).status()
    assert not current["supported"]
    assert not current["can_repair"]


@pytest.mark.parametrize("revision", [6, REVISION + 1])
def test_unchecked_integration_revision_requires_repair_even_with_intact_assets(tmp_path, revision):
    target, state, build = fixture(tmp_path)
    deploy(build, target, state, "v2.19.0")
    manifest_path = target / MANIFEST
    manifest = json.loads(manifest_path.read_text())
    manifest["revision"] = revision
    manifest_path.write_text(json.dumps(manifest))

    integration = MainsailIntegration(target, state, True)
    current = integration.status()
    assert not current["healthy"]
    assert current["can_repair"]
    assert current["reason"] == "outdated"
    assert current["revision"] == revision
    assert current["latest_revision"] == REVISION

    # Changed assets still need repair, even if the manifest is also outdated.
    (target / "assets/tools.js").unlink()
    assert integration.status()["reason"] == "changed"

    deploy(build, target, state, "v2.19.0")
    assert integration.status()["healthy"]


@pytest.mark.parametrize("revision", sorted(COMPATIBLE_REVISIONS))
def test_compatible_integration_needs_no_rebuild_and_keeps_native_route(tmp_path, revision):
    target, state, build = fixture(tmp_path)
    deploy(build, target, state, "v2.19.0")
    manifest_path = target / MANIFEST
    manifest = json.loads(manifest_path.read_text())
    manifest["revision"] = revision
    manifest_path.write_text(json.dumps(manifest))
    write_json(state / "status.json", {"state": "building", "updated": time.time()})
    settings = replace(
        Settings.from_env(),
        mock=False,
        klipper_config=None,
        mainsail_dir=target,
        mainsail_state_dir=state,
        mainsail_repair_enabled=True,
    )
    client = TestClient(create_app(settings, MockPrinter()))

    current = client.get("/api/mainsail/integration").json()
    assert current["healthy"]
    assert current["reason"] is None
    assert revision in current["compatible_revisions"]
    assert not current["busy"]
    assert not current["can_repair"]
    entry = client.get("/api/mainsail/entry", follow_redirects=False)
    assert entry.status_code == 200
    assert entry.text == "patched"

    (target / "assets/tools.js").unlink()
    current = client.get("/api/mainsail/integration").json()
    assert not current["healthy"]
    assert current["reason"] == "changed"
    assert current["can_repair"]


@pytest.mark.parametrize("pending", [False, True])
def test_stopped_build_does_not_remain_busy_and_can_be_retried(tmp_path, pending):
    target, state, _ = fixture(tmp_path)
    saved = {"state": "building", "updated": time.time()}
    write_json(state / "status.json", saved)
    if pending:
        (state / "request").touch()
    integration = MainsailIntegration(target, state, True)

    current = integration.status()
    assert not current["busy"]
    assert current["job"] == "interrupted"
    assert current["can_repair"]
    assert json.loads((state / "status.json").read_text()) == saved
    assert not (state / "worker.lock").exists()

    integration.request_repair()
    assert integration.status()["busy"]
    assert integration.status()["job"] == "queued"


def test_os_lock_identifies_running_build_even_with_old_status_and_no_request(tmp_path):
    target, state, _ = fixture(tmp_path)
    saved = {"state": "building", "updated": time.time() - 7200}
    write_json(state / "status.json", saved)
    integration = MainsailIntegration(target, state, True)

    with (state / "worker.lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        current = integration.status()
        assert current["busy"]
        assert current["job"] == "building"
        assert not current["can_repair"]
        with pytest.raises(ValueError, match="already queued or running"):
            integration.request_repair()
        assert not (state / "request").exists()
        assert json.loads((state / "status.json").read_text()) == saved

    assert not integration.status()["busy"]
    assert integration.status()["job"] == "interrupted"


def test_worker_can_start_after_brief_status_probe_but_refuses_second_worker(tmp_path, monkeypatch):
    target, state, _ = fixture(tmp_path)
    path = state / "worker.lock"
    blocked = Event()
    flock = fcntl.flock

    def observe_lock(lock, flags):
        try:
            return flock(lock, flags)
        except BlockingIOError:
            blocked.set()
            raise

    monkeypatch.setattr(fcntl, "flock", observe_lock)
    with path.open("w") as worker, ThreadPoolExecutor(max_workers=1) as pool:
        with path.open("rb") as probe:
            flock(probe, fcntl.LOCK_SH)
            starting = pool.submit(acquire_worker_lock, worker)
            assert blocked.wait(timeout=1)
        starting.result(timeout=1)
        assert MainsailIntegration(target, state, True).status()["busy"]
        with path.open("w") as duplicate, pytest.raises(BlockingIOError):
            acquire_worker_lock(duplicate)


@pytest.mark.parametrize("age", [QUEUE_TIMEOUT + 1, -10])
def test_stale_or_future_queue_timestamp_does_not_disable_repair(tmp_path, age):
    target, state, _ = fixture(tmp_path)
    write_json(state / "status.json", {"state": "queued", "updated": time.time() - age})
    (state / "request").touch()
    integration = MainsailIntegration(target, state, True)

    assert not integration.status()["busy"]
    assert integration.status()["job"] == "interrupted"
    assert integration.status()["can_repair"]
    integration.request_repair()
    assert integration.status()["busy"]


def test_intact_integration_remains_healthy_after_worker_status_is_left_behind(tmp_path):
    target, state, build = fixture(tmp_path)
    deploy(build, target, state, "v2.19.0")
    write_json(state / "status.json", {"state": "building", "updated": time.time()})
    current = MainsailIntegration(target, state, True).status()

    assert current["healthy"]
    assert not current["busy"]
    assert not current["can_repair"]


def test_state_migration_preserves_original_backup_and_restore(tmp_path):
    target, state, build = fixture(tmp_path)
    deploy(build, target, state, "v2.19.0")
    destination = tmp_path / "outside-config" / "state"
    assert migrate_state(state, destination)
    assert not state.exists()
    assert MainsailIntegration(target, destination, True).status()["healthy"]
    backup = Path(json.loads((destination / "last-backup.json").read_text())["path"])
    assert backup.is_relative_to(destination)
    restore(target, backup)
    assert (target / "index.html").read_text() == "original"
    assert not migrate_state(state, destination)


def test_state_migration_refuses_to_overwrite_existing_state(tmp_path):
    _, state, _ = fixture(tmp_path)
    destination = tmp_path / "existing"
    destination.mkdir()
    with pytest.raises(ValueError, match="existing"):
        migrate_state(state, destination)
    assert state.exists()


def test_restore_retains_original_across_repeated_repairs(tmp_path):
    target, state, build = fixture(tmp_path)
    deploy(build, target, state, "v2.19.0")
    original_backup = json.loads((state / "last-backup.json").read_text())["path"]
    deploy(build, target, state, "v2.19.0")
    assert json.loads((state / "last-backup.json").read_text())["path"] == original_backup
    restore(target, Path(original_backup))
    assert (target / "index.html").read_text() == "original"
    assert (target / "sw.js").read_text() == "original service worker"
    assert not (target / MANIFEST).exists()
    assert not (target / "assets/tools.js").exists()


def test_refuses_release_changed_during_build_and_symlink_escape(tmp_path):
    target, state, build = fixture(tmp_path)
    with pytest.raises(ValueError, match="changed"):
        deploy(build, target, state, "v2.18.0")
    outside = tmp_path / "outside"
    outside.mkdir()
    (target / "assets").symlink_to(outside)
    with pytest.raises(ValueError, match="escapes"):
        deploy(build, target, state, "v2.19.0")
    assert (target / "index.html").read_text() == "original"
    assert not list(outside.iterdir())


def test_repair_api_checks_origin_print_state_and_duplicate_requests(tmp_path):
    target, state, build = fixture(tmp_path)
    printer = MockPrinter()
    settings = replace(
        Settings.from_env(),
        mock=False,
        klipper_config=None,
        mainsail_dir=target,
        mainsail_state_dir=state,
        mainsail_repair_enabled=True,
    )
    client = TestClient(create_app(settings, printer))
    assert (
        client.get("/api/mainsail/entry", follow_redirects=False).headers["location"]
        == "/api/klipper-tools/"
    )
    assert (
        client.post("/api/mainsail/repair", headers={"origin": "http://evil.invalid"}).status_code
        == 403
    )
    printer.data.print_state = "printing"
    assert client.post("/api/mainsail/repair").status_code == 409
    printer.data.print_state = "standby"
    client.app.state.calibrations.sessions["pid"] = SimpleNamespace(state="RUNNING")
    assert not client.get("/api/status").json()["integration_idle"]
    assert client.post("/api/mainsail/repair").status_code == 409
    client.app.state.calibrations.sessions.clear()
    assert client.post("/api/mainsail/repair").json() == {"status": "queued"}
    assert (state / "request").exists()
    assert client.post("/api/mainsail/repair").status_code == 409
    (state / "request").unlink()
    deploy(build, target, state, "v2.19.0")
    assert client.get("/api/mainsail/entry").text == "patched"
    assert client.post("/api/mainsail/repair").status_code == 409


def test_patch_refuses_unknown_source_layout(tmp_path):
    (tmp_path / "package.json").write_text('{"version":"99.0.0"}')
    with pytest.raises(ValueError, match="Unsupported"):
        patch_source(tmp_path, tmp_path / "Tools.vue")


def test_failed_deployment_rolls_back_entry_files_and_assets(tmp_path, monkeypatch):
    target, state, build = fixture(tmp_path)
    replace_file = Path.replace

    def fail_publish(path, destination):
        if path.name == "sw.js.kcw-tmp":
            raise OSError("Simulated failure publishing service worker")
        return replace_file(path, destination)

    monkeypatch.setattr(Path, "replace", fail_publish)
    with pytest.raises(OSError, match="Simulated"):
        deploy(build, target, state, "v2.19.0")
    assert (target / "index.html").read_text() == "original"
    assert (target / "sw.js").read_text() == "original service worker"
    assert not (target / "assets/tools.js").exists()
    assert not (target / MANIFEST).exists()
