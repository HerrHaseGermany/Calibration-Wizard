from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).parents[1]


def test_nginx_migration_is_idempotent_and_removable(tmp_path):
    target = tmp_path / "mainsail"
    original = "server {\n    listen 80;\n    location / { try_files $uri /index.html; }\n}\n"
    target.write_text(original)
    script = ROOT / "scripts/configure_nginx.py"
    snippet = ROOT / "config/nginx-location.conf"
    command = [sys.executable, str(script), str(target), str(snippet)]
    subprocess.run(command, check=True, capture_output=True)
    installed = target.read_text()
    assert "location = /tools/" in installed
    assert "location /tools/app/" in installed
    assert "location /tools/standalone/" in installed
    assert "location ^~ /api/klipper-tools/" in installed
    assert "return 301 /api/klipper-tools/$1$is_args$args;" in installed
    assert "proxy_pass http://127.0.0.1:7130/;" in installed
    assert subprocess.run(command, check=True, capture_output=True).stdout == b""
    assert target.read_text() == installed
    subprocess.run([*command, "--remove"], check=True, capture_output=True)
    assert target.read_text().strip() == original.strip()
