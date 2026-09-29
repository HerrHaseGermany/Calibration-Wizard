from __future__ import annotations

import uvicorn

from .api import create_app
from .logging_config import configure_logging
from .settings import Settings


def run() -> None:
    settings = Settings.from_env()
    configure_logging()
    uvicorn.run(create_app(settings), host=settings.host, port=settings.port)


if __name__ == "__main__":
    run()
