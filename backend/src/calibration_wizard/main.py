from __future__ import annotations

import logging
import os
import subprocess
import sys
from pathlib import Path

import uvicorn

from .api import create_app
from .logging_config import configure_logging
from .settings import Settings


def sync_mainsail_navigation(settings: Settings) -> None:
    if settings.mock:
        return
    configured = os.getenv("KCW_MAINSAIL_NAVI")
    if configured:
        navigation = Path(configured)
    elif settings.klipper_config:
        navigation = settings.klipper_config.parent / ".theme" / "navi.json"
    else:
        return
    if not navigation.is_file():
        return
    root = Path(__file__).resolve().parents[3]
    try:
        subprocess.run(
            [
                sys.executable,
                str(root / "scripts" / "configure_mainsail.py"),
                str(navigation),
                str(root / "config" / "mainsail-navi-entry.json"),
            ],
            check=True,
            capture_output=True,
            text=True,
            timeout=10,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        logging.getLogger(__name__).warning("Could not update Mainsail navigation: %s", exc)


def run() -> None:
    settings = Settings.from_env()
    configure_logging()
    sync_mainsail_navigation(settings)
    uvicorn.run(create_app(settings), host=settings.host, port=settings.port)


if __name__ == "__main__":
    run()
