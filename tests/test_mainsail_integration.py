from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace

import pytest
from calibration_wizard.api import create_app
from calibration_wizard.mainsail_build import deploy, patch_source, restore
from calibration_wizard.mainsail_integration import MANIFEST, MainsailIntegration
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
    assert json.loads((target / "config.json").read_text())["hostname"] == "custom"
    (target / "index.html").write_text("overwritten")
    assert integration.status()["can_repair"]
    deploy(build, target, state, "v2.19.0")
    (target / "assets/tools.js").unlink()
    assert not integration.status()["healthy"]


def test_unsupported_version_cannot_be_repaired(tmp_path):
    target, state, _ = fixture(tmp_path)
    (target / "release_info.json").write_text('{"version":"v99.0.0"}')
    current = MainsailIntegration(target, state, True).status()
    assert not current["supported"]
    assert not current["can_repair"]


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
