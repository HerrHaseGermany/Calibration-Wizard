from pathlib import Path

import pytest
from calibration_wizard.configuration import ConfigError, KlipperConfigRepository


def test_finds_and_updates_setting_in_include(tmp_path: Path):
    root = tmp_path / "printer.cfg"
    included = tmp_path / "hardware" / "extruder.cfg"
    included.parent.mkdir()
    root.write_text("[include hardware/*.cfg]\n", encoding="utf-8")
    included.write_text(
        "[extruder]\nrotation_distance: 4.706 # calibrated\nmin_extrude_temp: 170\n",
        encoding="utf-8",
    )
    repository = KlipperConfigRepository(root, tmp_path / "backups")

    found = repository.find("extruder", "rotation_distance")
    source, backup = repository.update_rotation_distance("extruder", 4.706, 4.51776)

    assert found.source == included.resolve()
    assert source == included.resolve()
    assert backup.read_text(encoding="utf-8").startswith("[extruder]")
    assert "rotation_distance: 4.51776000 # calibrated" in included.read_text(encoding="utf-8")


def test_refuses_stale_expected_value(tmp_path: Path):
    root = tmp_path / "printer.cfg"
    root.write_text("[extruder]\nrotation_distance: 5.0\n", encoding="utf-8")
    repository = KlipperConfigRepository(root, tmp_path / "backups")

    with pytest.raises(ConfigError, match="changed since calibration"):
        repository.update_rotation_distance("extruder", 4.0, 4.5)


def test_duplicate_setting_is_ambiguous(tmp_path: Path):
    root = tmp_path / "printer.cfg"
    other = tmp_path / "other.cfg"
    root.write_text("[extruder]\nrotation_distance: 4.7\n[include other.cfg]\n", encoding="utf-8")
    other.write_text("[extruder]\nrotation_distance: 4.8\n", encoding="utf-8")
    repository = KlipperConfigRepository(root, tmp_path / "backups")

    with pytest.raises(ConfigError, match="ambiguous"):
        repository.find("extruder", "rotation_distance")


def test_reads_external_symlink_include_but_never_writes_it(tmp_path: Path):
    config_dir = tmp_path / "config"
    config_dir.mkdir()
    root = config_dir / "printer.cfg"
    outside = tmp_path / "outside.cfg"
    outside.write_text("[extruder]\nrotation_distance: 4.7\n", encoding="utf-8")
    linked = config_dir / "outside.cfg"
    linked.symlink_to(outside)
    root.write_text("[include outside.cfg]\n", encoding="utf-8")
    repository = KlipperConfigRepository(root, tmp_path / "backups")

    assert repository.find("extruder", "rotation_distance").source == outside.resolve()
    with pytest.raises(ConfigError, match="outside the writable config root"):
        repository.update_rotation_distance("extruder", 4.7, 4.6)


def test_direct_setting_resolves_with_external_nested_include(tmp_path: Path):
    config_dir = tmp_path / "config"
    vendor_dir = tmp_path / "vendor"
    config_dir.mkdir()
    vendor_dir.mkdir()
    root = config_dir / "printer.cfg"
    vendor = vendor_dir / "mainsail.cfg"
    client = vendor_dir / "client.cfg"
    (config_dir / "mainsail.cfg").symlink_to(vendor)
    vendor.write_text("[include client.cfg]\n", encoding="utf-8")
    client.write_text("[gcode_macro CLIENT]\ngcode:\n", encoding="utf-8")
    root.write_text(
        "[include mainsail.cfg]\n[extruder]\nrotation_distance: 4.518\n",
        encoding="utf-8",
    )
    repository = KlipperConfigRepository(root, tmp_path / "backups")

    found = repository.find("extruder", "rotation_distance")
    assert found.source == root.resolve()


def test_updates_multiline_section_without_removing_unrelated_settings(tmp_path: Path):
    root = tmp_path / "printer.cfg"
    root.write_text(
        "[bed_mesh]\n"
        "speed: 100\n"
        "mesh_min: 10, 10\n"
        "mesh_max: 200, 200\n"
        "probe_count:\n"
        "  5, 5\n"
        "algorithm: bicubic\n",
        encoding="utf-8",
    )
    repository = KlipperConfigRepository(root, tmp_path / "backups")
    fingerprint = repository.fingerprint()

    _source, backup = repository.update_section_settings(
        "bed_mesh",
        {"mesh_min": "20, 20", "mesh_max": "190, 190", "probe_count": "7, 7"},
        fingerprint,
    )

    updated = root.read_text(encoding="utf-8")
    assert "algorithm: bicubic" in updated
    assert "mesh_min: 20, 20" in updated
    assert "probe_count: 7, 7" in updated
    assert "mesh_min: 10, 10" in backup.read_text(encoding="utf-8")


def test_new_section_is_inserted_before_save_config_footer(tmp_path: Path):
    root = tmp_path / "printer.cfg"
    root.write_text(
        "[printer]\nkinematics: corexy\n"
        "#*# <---------------------- SAVE_CONFIG ---------------------->\n"
        "#*# [probe]\n",
        encoding="utf-8",
    )
    repository = KlipperConfigRepository(root, tmp_path / "backups")

    repository.update_section_settings(
        "z_tilt",
        {"z_positions": "0, 100\n200, 100", "points": "20, 100\n180, 100"},
    )

    updated = root.read_text(encoding="utf-8")
    assert updated.index("[z_tilt]") < updated.index("#*# <---")
    assert "z_positions:\n  0, 100\n  200, 100" in updated


def test_section_update_refuses_stale_preview(tmp_path: Path):
    root = tmp_path / "printer.cfg"
    root.write_text("[bed_mesh]\nmesh_min: 0, 0\n", encoding="utf-8")
    repository = KlipperConfigRepository(root, tmp_path / "backups")
    fingerprint = repository.fingerprint()
    root.write_text("[bed_mesh]\nmesh_min: 1, 1\n", encoding="utf-8")

    with pytest.raises(ConfigError, match="changed since preview"):
        repository.update_section_settings("bed_mesh", {"mesh_min": "2, 2"}, fingerprint)


def test_variable_screw_count_removes_obsolete_points(tmp_path: Path):
    root = tmp_path / "printer.cfg"
    root.write_text(
        "[bed_screws]\n"
        "screw1: 0, 0\n"
        "screw2: 100, 0\n"
        "screw3: 100, 100\n"
        "screw4: 0, 100\n"
        "screw4_name: old fourth\n"
        "speed: 50\n",
        encoding="utf-8",
    )
    repository = KlipperConfigRepository(root, tmp_path / "backups")

    repository.update_section_settings(
        "bed_screws",
        {"screw1": "0, 0", "screw2": "100, 0", "screw3": "50, 100"},
        remove_key_patterns=(r"screw\d+(?:_name)?",),
    )

    updated = root.read_text(encoding="utf-8")
    assert "screw4" not in updated
    assert "speed: 50" in updated
