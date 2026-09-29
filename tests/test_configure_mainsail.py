from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

SCRIPT = Path(__file__).parents[1] / "scripts" / "configure_mainsail.py"
ENTRY = Path(__file__).parents[1] / "config" / "mainsail-navi-entry.json"


def run_script(*arguments: Path | str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(SCRIPT), *(str(value) for value in arguments)],
        check=True,
        capture_output=True,
        text=True,
    )


def test_installs_sidebar_entry_and_preserves_existing_items(tmp_path: Path):
    navigation = tmp_path / ".theme" / "navi.json"
    navigation.parent.mkdir()
    existing = [{"title": "Camera", "href": "/camera/", "position": 20}]
    navigation.write_text(json.dumps(existing), encoding="utf-8")

    result = run_script(navigation, ENTRY)

    values = json.loads(navigation.read_text(encoding="utf-8"))
    assert values[0] == existing[0]
    assert values[1]["href"] == "/calibration/"
    assert Path(result.stdout.strip()).exists()


def test_install_is_idempotent(tmp_path: Path):
    navigation = tmp_path / "navi.json"
    run_script(navigation, ENTRY)
    original = navigation.read_bytes()

    result = run_script(navigation, ENTRY)

    assert navigation.read_bytes() == original
    assert result.stdout == "\n"
    assert len(list(tmp_path.glob("navi.json.kcw-backup-*"))) == 0


def test_updates_an_existing_calibration_entry(tmp_path: Path):
    navigation = tmp_path / "navi.json"
    navigation.write_text(
        json.dumps([{"title": "Old", "href": "/calibration", "position": 99}]),
        encoding="utf-8",
    )

    run_script(navigation, ENTRY)

    values = json.loads(navigation.read_text(encoding="utf-8"))
    assert len(values) == 1
    assert values[0]["title"] == "Calibration"
    assert values[0]["position"] == 45


def test_remove_deletes_only_the_managed_entry(tmp_path: Path):
    navigation = tmp_path / "navi.json"
    existing = [
        {"title": "Camera", "href": "/camera/"},
        {"title": "Calibration", "href": "/calibration/"},
    ]
    navigation.write_text(json.dumps(existing), encoding="utf-8")

    run_script("--remove", navigation)

    assert json.loads(navigation.read_text(encoding="utf-8")) == existing[:1]
