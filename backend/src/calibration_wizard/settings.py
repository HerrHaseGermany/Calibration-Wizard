from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    host: str
    port: int
    mock: bool
    moonraker_url: str
    moonraker_api_key: str | None
    klipper_config: Path | None
    backup_dir: Path
    frontend_dir: Path

    @classmethod
    def from_env(cls) -> Settings:
        project_root = Path(__file__).resolve().parents[3]
        config_value = os.getenv("KCW_KLIPPER_CONFIG")
        return cls(
            host=os.getenv("KCW_HOST", "127.0.0.1"),
            port=int(os.getenv("KCW_PORT", "7130")),
            mock=os.getenv("KCW_MOCK", "false").lower() in {"1", "true", "yes"},
            moonraker_url=os.getenv("KCW_MOONRAKER_URL", "http://127.0.0.1:7125"),
            moonraker_api_key=os.getenv("KCW_MOONRAKER_API_KEY"),
            klipper_config=Path(config_value) if config_value else None,
            backup_dir=Path(os.getenv("KCW_BACKUP_DIR", str(project_root / "backups"))),
            frontend_dir=Path(os.getenv("KCW_FRONTEND_DIR", str(project_root / "frontend"))),
        )
