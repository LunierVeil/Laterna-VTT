import json
import os
from pathlib import Path
import subprocess
import sys
import time

from .test_instance_backup import storage  # noqa: F401


def test_cli_requests_online_copy_and_restores_from_another_cwd(storage, tmp_path):
    paths, _ = storage
    source = Path(paths.data_home)
    server = Path(__file__).resolve().parents[1]
    env = dict(os.environ, PYTHONPATH=str(server), LANTERNA_DATA_HOME=str(source),
               LANTERNA_BACKUP_CONTROL="1", PYTHONUTF8="1")
    for name in ("DATABASE_URL", "UPLOAD_DIR", "GM_KEY_FILE", "LANTERNA_GM_KEY", "LANTERNA_PORTABLE"):
        env.pop(name, None)

    def cli(*args):
        return subprocess.run([sys.executable, "-m", "app.backup_cli", *map(str, args)],
                              cwd=tmp_path, env=env, capture_output=True, text=True, timeout=20)

    assert cli("create").returncode == 1
    script = """
import sys
from fastapi.testclient import TestClient
from app.main import app

with TestClient(app, client=('127.0.0.1', 8000)) as client:
    for route in ('/api/backup', '/api/backup/create', '/api/backup/restore'):
        response = client.post(route, headers={'Origin': 'https://external.test',
                                             'X-Forwarded-For': '127.0.0.1'}, json={'path': '/tmp'})
        assert response.status_code in (404, 405), response
    print('ready', flush=True)
    sys.stdin.readline()
"""
    payload = {p: p.read_bytes() for p in (source / "lanterna.db", source / "gm_key.txt")}
    with subprocess.Popen([sys.executable, "-c", script], cwd=tmp_path, env=env, text=True,
                          stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE) as owner:
        try:
            active = source / ".backup-control" / "active"
            deadline = time.monotonic() + 10
            while not active.exists() and owner.poll() is None and time.monotonic() < deadline:
                time.sleep(0.05)
            assert active.exists()
            created = cli("create")
            assert created.returncode == 0, created.stderr
            bundle = Path(created.stdout.split("Location: ", 1)[1].strip())
            assert bundle.parent == tmp_path / "Laterna Backups"
            assert json.loads((bundle / "manifest.json").read_text())["complete"]
            assert cli("verify", bundle).returncode == 0
            assert cli("restore", bundle, source).returncode == 1
            destination = tmp_path / "Новый стол"
            assert cli("restore", bundle, destination).returncode == 0
            assert (destination / "gm_key.txt").read_bytes() == payload[source / "gm_key.txt"]
            assert all(path.read_bytes() == before for path, before in payload.items())
            assert payload[source / "gm_key.txt"].decode() not in created.stdout
        finally:
            try:
                _, errors = owner.communicate("\n", timeout=15)
            except subprocess.TimeoutExpired:
                owner.kill()
                stdout, errors = owner.communicate()
                raise AssertionError(f"Owner did not stop: {stdout} {errors}")
        assert owner.returncode == 0, errors
