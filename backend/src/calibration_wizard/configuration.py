from __future__ import annotations

import glob
import hashlib
import os
import re
import shutil
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path


class ConfigError(RuntimeError):
    pass


SECTION_RE = re.compile(r"^\s*\[([^]]+)]\s*(?:[#;].*)?$")
INCLUDE_RE = re.compile(r"^include\s+(.+)$", re.IGNORECASE)


@dataclass(frozen=True)
class ConfigValue:
    section: str
    key: str
    value: str
    source: Path
    line_number: int


class KlipperConfigRepository:
    """Resolve Klipper includes and update one unambiguous setting atomically."""

    def __init__(self, root_file: Path, backup_dir: Path):
        self.root_file = root_file.expanduser().resolve()
        self.config_root = self.root_file.parent
        self.backup_dir = backup_dir.expanduser().resolve()

    def _require_writable_path(self, path: Path) -> Path:
        resolved = path.expanduser().resolve()
        try:
            resolved.relative_to(self.config_root)
        except ValueError as exc:
            raise ConfigError(
                f"Setting source is outside the writable config root: {resolved}"
            ) from exc
        return resolved

    def _walk(self, path: Path, seen: set[Path]) -> list[Path]:
        # Klipper installations commonly symlink vendor includes (for example
        # mainsail.cfg) outside printer_data/config. They must be read to detect
        # duplicate settings, but are never eligible for writes.
        path = path.expanduser().resolve()
        if path in seen:
            return []
        if not path.is_file():
            raise ConfigError(f"Configuration file does not exist: {path}")
        seen.add(path)
        files = [path]
        for raw_line in path.read_text(encoding="utf-8").splitlines():
            section_match = SECTION_RE.match(raw_line)
            if not section_match:
                continue
            include_match = INCLUDE_RE.match(section_match.group(1).strip())
            if not include_match:
                continue
            pattern = include_match.group(1).strip()
            candidate_pattern = (
                Path(pattern) if Path(pattern).is_absolute() else path.parent / pattern
            )
            matches = [Path(item) for item in sorted(glob.glob(str(candidate_pattern)))]
            if not matches:
                raise ConfigError(f"Include pattern matched no files: {pattern}")
            for match in matches:
                files.extend(self._walk(match, seen))
        return files

    def files(self) -> list[Path]:
        return self._walk(self.root_file, set())

    def fingerprint(self) -> str:
        digest = hashlib.sha256()
        for path in sorted(self.files()):
            digest.update(str(path).encode())
            digest.update(path.read_bytes())
        return digest.hexdigest()

    def _section_locations(self, section: str) -> list[tuple[Path, int, int]]:
        locations: list[tuple[Path, int, int]] = []
        for path in self.files():
            lines = path.read_text(encoding="utf-8").splitlines(keepends=True)
            starts = [
                index
                for index, line in enumerate(lines)
                if (match := SECTION_RE.match(line))
                and match.group(1).strip().casefold() == section.casefold()
            ]
            for start in starts:
                end = len(lines)
                for index in range(start + 1, len(lines)):
                    if SECTION_RE.match(lines[index]):
                        end = index
                        break
                locations.append((path, start, end))
        return locations

    def find(self, section: str, key: str) -> ConfigValue:
        matches: list[ConfigValue] = []
        for path in self.files():
            current_section: str | None = None
            for number, raw_line in enumerate(
                path.read_text(encoding="utf-8").splitlines(), start=1
            ):
                section_match = SECTION_RE.match(raw_line)
                if section_match:
                    current_section = section_match.group(1).strip()
                    continue
                if current_section and current_section.casefold() == section.casefold():
                    setting_match = re.match(
                        rf"^\s*{re.escape(key)}\s*[:=]\s*([^#;]+)", raw_line, re.IGNORECASE
                    )
                    if setting_match:
                        matches.append(
                            ConfigValue(
                                section=current_section,
                                key=key,
                                value=setting_match.group(1).strip(),
                                source=path,
                                line_number=number,
                            )
                        )
        if not matches:
            raise ConfigError(f"[{section}] {key} was not found in the loaded config tree")
        if len(matches) != 1:
            locations = ", ".join(f"{m.source}:{m.line_number}" for m in matches)
            raise ConfigError(f"Setting is ambiguous; found at {locations}")
        return matches[0]

    def update_rotation_distance(
        self, section: str, expected_old: float, new_value: float
    ) -> tuple[Path, Path]:
        setting = self.find(section, "rotation_distance")
        self._require_writable_path(setting.source)
        try:
            actual_old = float(setting.value)
        except ValueError as exc:
            raise ConfigError("Existing rotation_distance is not a plain number") from exc
        if abs(actual_old - expected_old) > max(1e-7, abs(expected_old) * 1e-6):
            raise ConfigError(
                "Configuration changed since calibration; refusing to overwrite the current value"
            )

        source = setting.source
        original = source.read_text(encoding="utf-8")
        lines = original.splitlines(keepends=True)
        line = lines[setting.line_number - 1]
        match = re.match(r"^(\s*rotation_distance\s*[:=]\s*)([^#;\r\n]+)(.*)$", line, re.IGNORECASE)
        if not match:
            raise ConfigError("Could not safely rewrite the rotation_distance line")
        newline = "\n" if line.endswith("\n") else ""
        value_field = match.group(2)
        spacing = value_field[len(value_field.rstrip()) :]
        tail = match.group(3).rstrip("\r\n")
        lines[setting.line_number - 1] = f"{match.group(1)}{new_value:.8f}{spacing}{tail}{newline}"

        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        relative = source.relative_to(self.config_root)
        backup = self.backup_dir / stamp / relative
        backup.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        shutil.copy2(source, backup)

        fd, temporary_name = tempfile.mkstemp(prefix=f".{source.name}.", dir=source.parent)
        temporary = Path(temporary_name)
        try:
            with os.fdopen(fd, "w", encoding="utf-8", newline="") as handle:
                handle.writelines(lines)
                handle.flush()
                os.fsync(handle.fileno())
            os.chmod(temporary, source.stat().st_mode)
            os.replace(temporary, source)
        finally:
            temporary.unlink(missing_ok=True)
        return source, backup

    def upsert_numeric(self, section: str, key: str, new_value: float) -> tuple[Path, Path]:
        """Update or insert a numeric value in one unambiguous writable section."""
        if not isinstance(new_value, (int, float)) or not float("-inf") < new_value < float("inf"):
            raise ConfigError("New value must be finite")
        try:
            setting = self.find(section, key)
        except ConfigError as exc:
            if "was not found" not in str(exc):
                raise
            section_matches: list[tuple[Path, int]] = []
            for path in self.files():
                for number, raw_line in enumerate(
                    path.read_text(encoding="utf-8").splitlines(), start=1
                ):
                    match = SECTION_RE.match(raw_line)
                    if match and match.group(1).strip().casefold() == section.casefold():
                        section_matches.append((path, number))
            if len(section_matches) != 1:
                raise ConfigError(f"Section [{section}] is missing or ambiguous") from exc
            source, section_line = section_matches[0]
            source = self._require_writable_path(source)
            original = source.read_text(encoding="utf-8")
            lines = original.splitlines(keepends=True)
            insert_at = len(lines)
            for index in range(section_line, len(lines)):
                if SECTION_RE.match(lines[index]):
                    insert_at = index
                    break
            lines.insert(insert_at, f"{key}: {new_value:.8f}\n")
        else:
            source = self._require_writable_path(setting.source)
            original = source.read_text(encoding="utf-8")
            lines = original.splitlines(keepends=True)
            line = lines[setting.line_number - 1]
            match = re.match(
                rf"^(\s*{re.escape(key)}\s*[:=]\s*)([^#;\r\n]+)(.*)$", line, re.IGNORECASE
            )
            if not match:
                raise ConfigError(f"Could not safely rewrite {key}")
            newline = "\n" if line.endswith("\n") else ""
            spacing = match.group(2)[len(match.group(2).rstrip()) :]
            tail = match.group(3).rstrip("\r\n")
            lines[setting.line_number - 1] = (
                f"{match.group(1)}{new_value:.8f}{spacing}{tail}{newline}"
            )

        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        relative = source.relative_to(self.config_root)
        backup = self.backup_dir / stamp / relative
        backup.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        shutil.copy2(source, backup)
        fd, temporary_name = tempfile.mkstemp(prefix=f".{source.name}.", dir=source.parent)
        temporary = Path(temporary_name)
        try:
            with os.fdopen(fd, "w", encoding="utf-8", newline="") as handle:
                handle.writelines(lines)
                handle.flush()
                os.fsync(handle.fileno())
            os.chmod(temporary, source.stat().st_mode)
            os.replace(temporary, source)
        finally:
            temporary.unlink(missing_ok=True)
        return source, backup

    def update_section_settings(
        self,
        section: str,
        settings: dict[str, str],
        expected_fingerprint: str | None = None,
        remove_key_patterns: tuple[str, ...] = (),
    ) -> tuple[Path, Path]:
        """Update whitelisted settings while retaining unrelated section content."""
        if expected_fingerprint and self.fingerprint() != expected_fingerprint:
            raise ConfigError(
                "Configuration changed since preview; refusing to overwrite newer values"
            )
        if not settings:
            raise ConfigError("No section settings were supplied")
        for key, value in settings.items():
            if not re.fullmatch(r"[a-zA-Z0-9_]+", key):
                raise ConfigError(f"Invalid setting name: {key}")
            if any(character in value for character in "[]#;\x00"):
                raise ConfigError(f"Unsafe characters in [{section}] {key}")

        locations = self._section_locations(section)
        if len(locations) > 1:
            found = ", ".join(str(path) for path, _start, _end in locations)
            raise ConfigError(f"Section [{section}] is ambiguous; found in {found}")
        if locations:
            source, start, end = locations[0]
            source = self._require_writable_path(source)
            original = source.read_text(encoding="utf-8")
            lines = original.splitlines(keepends=True)
            keys = {key.casefold() for key in settings}
            kept: list[str] = []
            index = start + 1
            while index < end:
                match = re.match(r"^\s*([a-zA-Z0-9_]+)\s*[:=]", lines[index])
                remove_match = match and any(
                    re.fullmatch(pattern, match.group(1), re.IGNORECASE)
                    for pattern in remove_key_patterns
                )
                if match and (match.group(1).casefold() in keys or remove_match):
                    index += 1
                    while index < end and (
                        lines[index].startswith((" ", "\t"))
                        and not re.match(r"^\s*[a-zA-Z0-9_]+\s*[:=]", lines[index])
                    ):
                        index += 1
                    continue
                kept.append(lines[index])
                index += 1
            replacement = [lines[start], *kept]
            if replacement and replacement[-1].strip():
                replacement.append("\n")
            replacement.extend(self._format_settings(settings))
            lines[start:end] = replacement
        else:
            source = self._require_writable_path(self.root_file)
            original = source.read_text(encoding="utf-8")
            lines = original.splitlines(keepends=True)
            insert_at = next(
                (
                    index
                    for index, line in enumerate(lines)
                    if line.startswith("#*# <---------------------- SAVE_CONFIG")
                ),
                len(lines),
            )
            block = [f"\n[{section}]\n", *self._format_settings(settings)]
            lines[insert_at:insert_at] = block
        return self._atomic_write_with_backup(source, lines)

    @staticmethod
    def _format_settings(settings: dict[str, str]) -> list[str]:
        output: list[str] = []
        for key, value in settings.items():
            parts = [part.strip() for part in value.splitlines() if part.strip()]
            if len(parts) <= 1:
                output.append(f"{key}: {parts[0] if parts else ''}\n")
            else:
                output.append(f"{key}:\n")
                output.extend(f"  {part}\n" for part in parts)
        return output

    def _atomic_write_with_backup(self, source: Path, lines: list[str]) -> tuple[Path, Path]:
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        relative = source.relative_to(self.config_root)
        backup = self.backup_dir / stamp / relative
        backup.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        shutil.copy2(source, backup)
        fd, temporary_name = tempfile.mkstemp(prefix=f".{source.name}.", dir=source.parent)
        temporary = Path(temporary_name)
        try:
            with os.fdopen(fd, "w", encoding="utf-8", newline="") as handle:
                handle.writelines(lines)
                handle.flush()
                os.fsync(handle.fileno())
            os.chmod(temporary, source.stat().st_mode)
            os.replace(temporary, source)
        finally:
            temporary.unlink(missing_ok=True)
        return source, backup
