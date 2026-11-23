"""Run against extracted Windows ZIPs using the bundled Python."""
from contextlib import closing, contextmanager
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import time
import urllib.request

app, replacement, temporary = map(Path, sys.argv[1:])
profile = temporary / "Профиль Windows"
profile.mkdir()
home = profile / "LaternaVTT"
spare_profile = temporary / "Spare profile"
spare_profile.mkdir()
env = dict(os.environ, LOCALAPPDATA=str(profile), PYTHONUTF8="1")
for variable in ("DATABASE_URL", "UPLOAD_DIR", "GM_KEY_FILE", "LANTERNA_DATA_HOME",
                 "LANTERNA_PORTABLE", "LANTERNA_GM_KEY", "WEB_CONCURRENCY", "UVICORN_WORKERS"):
    env.pop(variable, None)


spare_env = dict(env, LOCALAPPDATA=str(spare_profile))


def menu(package, *args, settings=None, input=None, succeeds=True):
    proc = subprocess.run(
        ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass",
         "-File", str(package / "laterna.ps1"), *args],
        input=input, cwd=temporary, env=settings or env,
        capture_output=True, encoding="utf-8", errors="replace", timeout=30,
    )
    assert (proc.returncode == 0) == succeeds, "Unexpected launcher exit: " + proc.stderr
    return proc.stdout


_CHILD = """
import asyncio, socket, sys
from pathlib import Path
sys.path.insert(0, str(Path(sys.argv[1]) / 'server'))
from app.main import app, lifespan
async def main():
    async with lifespan(app), asyncio_context():
        pass
from contextlib import asynccontextmanager
@asynccontextmanager
async def asyncio_context():
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', int(sys.argv[3])))
        listener.listen()
        marker = Path(sys.argv[2])
        staging = marker.with_suffix('.tmp')
        staging.write_text(str(listener.getsockname()[1]))
        staging.replace(marker)
        await asyncio.to_thread(sys.stdin.readline)
        yield
asyncio.run(main())
"""


@contextmanager
def process(package, label, settings=None, port=0):
    marker = temporary / (label + ".ready")
    proc = subprocess.Popen(
        [str(package / "python/python.exe"), "-X", "utf8", "-c", _CHILD, str(package), str(marker), str(port)],
        cwd=temporary, env=settings or env, stdin=subprocess.PIPE,
        stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, encoding="utf-8", errors="replace",
    )
    try:
        yield proc, marker
    finally:
        if proc.poll() is None:
            proc.kill()
        proc.communicate(timeout=10)


def ready(proc, marker):
    deadline = time.monotonic() + 20
    while not marker.exists() and proc.poll() is None and time.monotonic() < deadline:
        time.sleep(.05)
    assert marker.exists(), proc.stderr.read() if proc.poll() is not None else "Startup timed out"
    return int(marker.read_text())


def refused(proc, marker, message):
    _, error = proc.communicate(timeout=20)
    assert proc.returncode != 0 and not marker.exists() and message in error, error


def stopped(proc):
    _, error = proc.communicate("\n", timeout=20)
    assert proc.returncode == 0, error


def digest(directory):
    return {str(path.relative_to(directory)): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in directory.rglob("*") if path.is_file()}


def free_port():
    import socket
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return listener.getsockname()[1]


paths = menu(app, "-Storage", "Profile", "-Action", "Paths")
assert Path(json.loads(paths.splitlines()[-1])["home"]) == home
assert not home.exists()
lan_port = free_port()
startup_log = temporary / "launcher.log"
with startup_log.open("w", encoding="utf-8") as output:
    launcher = subprocess.Popen(
        ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass",
         "-File", str(app / "laterna.ps1"), "-Action", "Lan"],
        cwd=temporary, env=dict(env, PORT=str(lan_port)), stdout=output, stderr=output,
    )
    try:
        deadline = time.monotonic() + 25
        while time.monotonic() < deadline and launcher.poll() is None:
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{lan_port}/api/health", timeout=1) as response:
                    assert response.status == 200
                    break
            except OSError:
                time.sleep(.1)
        else:
            raise AssertionError(startup_log.read_text(encoding="utf-8", errors="replace"))
    finally:
        if launcher.poll() is None:
            subprocess.run(["taskkill.exe", "/PID", str(launcher.pid), "/T", "/F"],
                           capture_output=True, timeout=10, check=True)
        launcher.wait(timeout=10)
assert (home / "lanterna.db").is_file()
assert (home / "gm_key.txt").read_text().strip() not in startup_log.read_text(encoding="utf-8", errors="replace")
with process(app, "first") as (first, marker):
    first_port = ready(first, marker)
    (home / "uploads" / "synthetic.txt").write_text("zip replacement")
    original = digest(home)
    port = free_port()
    assert port != first_port
    with process(replacement, "busy", port=port) as other:
        refused(*other, "Хранилище уже занято")
    assert digest(home) == original
    with process(replacement, "independent",
                 dict(spare_env, LANTERNA_DATA_HOME=str(temporary / "Независимые данные"))) as other:
        assert ready(*other) != first_port
        stopped(other[0])
    stopped(first)
assert digest(home) == original
paths = menu(replacement, "-Storage", "Profile", "-Action", "Paths")
assert Path(json.loads(paths.splitlines()[-1])["home"]) == home
key = (home / "gm_key.txt").read_text().strip()
assert "?gm=" + key in menu(replacement, "-Action", "GmLink")
assert key not in menu(replacement, "-Action", "Backup", succeeds=False)
assert not (replacement / "backup").exists()
with process(replacement, "second") as owner:
    ready(*owner)
    owner[0].kill()
    owner[0].wait(timeout=10)
assert list(profile.glob(".laterna-*.lock"))
with process(replacement, "after-crash") as owner:
    ready(*owner)
    stopped(owner[0])
assert digest(home) == original
database = home / "lanterna.db"
try:
    database.chmod(0o400)
    with process(replacement, "readonly") as owner:
        refused(*owner, "Нет доступа на чтение и запись")
finally:
    database.chmod(0o600)
assert digest(home) == original

portable = temporary / "Portable ZIP"
shutil.copytree(app, portable, ignore=shutil.ignore_patterns("laterna-storage-mode.txt"))
menu(portable, "-Storage", "NewPortable", input="5\n")
menu(portable, "-Action", "Paths", succeeds=False)
with process(portable, "portable", dict(spare_env, LANTERNA_PORTABLE="1")) as owner:
    ready(*owner)
    stopped(owner[0])
paths = menu(portable, "-Action", "Paths")
assert Path(json.loads(paths.splitlines()[-1])["home"]) == portable / "data"
assert digest(home) == original
menu(portable, "-Storage", "Profile", "-Action", "Paths", succeeds=False)
portable_marker = portable / "laterna-storage-mode.txt"
portable_marker.write_text("invalid", encoding="ascii")
menu(portable, "-Action", "Paths", succeeds=False)
assert digest(home) == original
portable_marker.unlink()
menu(portable, "-Storage", "Profile", "-Action", "Paths", succeeds=False)
menu(portable, "-Storage", "Portable", "-Action", "Paths")


with process(app, "race-one", dict(spare_env, LANTERNA_DATA_HOME=str(temporary / "race"))) as one, \
     process(app, "race-two", dict(spare_env, LANTERNA_DATA_HOME=str(temporary / "race"))) as two:
    limit = time.monotonic() + 20
    while one[0].poll() is None and two[0].poll() is None and time.monotonic() < limit:
        time.sleep(.05)
    loser = one if one[0].poll() is not None else two
    winner = two if loser is one else one
    refused(*loser, "Хранилище уже занято")
    ready(*winner)
    stopped(winner[0])

bad_profile = temporary / "Bad Profile"
bad_profile.mkdir()
bad_home = bad_profile / "LaternaVTT"
bad_home.mkdir()
(bad_home / "uploads").mkdir()
(bad_home / "gm_key.txt").write_text("synthetic")
(bad_home / "lanterna.db").write_bytes(b"corrupt")
before = digest(bad_home)
for label in ("corrupt", "corrupt-repeat"):
    with process(app, label, dict(env, LOCALAPPDATA=str(bad_profile))) as owner:
        refused(*owner, "SQLite не читается")
assert digest(bad_home) == before
with process(app, "missing-profile", dict(env, LOCALAPPDATA=str(temporary / "missing"))) as owner:
    refused(*owner, "Родительский каталог хранилища отсутствует")
assert not (temporary / "missing").exists()
alpha = app / "server" / "lanterna.db"
alpha.write_bytes(b"synthetic alpha")
clean_profile = temporary / "Alpha profile"
clean_profile.mkdir()
with process(app, "alpha", dict(env, LOCALAPPDATA=str(clean_profile))) as owner:
    refused(*owner, "Найдены прежние данные")
assert alpha.read_bytes() == b"synthetic alpha"
assert not (clean_profile / "LaternaVTT").exists()
print("PASS: Windows DataHome, launcher, ZIP replacement, portable, contention and fail-closed startup")

def backup_flow(package, data_home, settings, label):
    asset = "b" * 32 + ".png"
    image = data_home / "uploads" / asset
    image.write_bytes(b"synthetic image")
    with closing(sqlite3.connect(data_home / "lanterna.db")) as conn:
        conn.execute("UPDATE scenes SET name=?, background_url=?", ("Recovered scene", "/uploads/" + asset))
        ids = conn.execute("SELECT id FROM campaigns").fetchall()
        conn.execute(
            "INSERT INTO characters (id,campaign_id,name,system,data_json,created_at,updated_at) "
            "VALUES ('smoke-character',?,'Recovered hero','dnd5e','{}',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",
            (ids[0][0],),
        )
        conn.commit()
    original = {path: path.read_bytes() for path in (image, data_home / "lanterna.db", data_home / "gm_key.txt")}
    server_settings = dict(settings, LANTERNA_BACKUP_CONTROL="1")
    if label == "portable":
        server_settings["LANTERNA_PORTABLE"] = "1"
    with process(package, label + "-backup", server_settings) as owner:
        ready(*owner)
        stdout = menu(package, "-Action", "Backup", settings=settings)
        assert "Verification: PASSED" in stdout
        assert (data_home / "gm_key.txt").read_text().strip() not in stdout
        copy = Path(stdout.split("Location: ", 1)[1].splitlines()[0])
        assert copy.parent == data_home.parent / "Laterna Backups"
        assert "Verification: PASSED" in menu(package, "-Action", "Verify", "-BackupPath", str(copy), settings=settings)
        destination = temporary / ("Восстановленный стол " + label)
        args = ("-Action", "Restore", "-BackupPath", str(copy), "-Destination")
        assert "Restore: SUCCESS" in menu(package, *args, str(destination), settings=settings)
        menu(package, *args, str(data_home), settings=settings, succeeds=False)
        menu(package, *args, str(destination), settings=settings, succeeds=False)
        stopped(owner[0])
    with process(package, label + "-restored",
                 dict(settings, LANTERNA_PORTABLE="0", LANTERNA_DATA_HOME=str(destination),
                      LANTERNA_REQUIRE_EXISTING="1")) as owner:
        ready(*owner)
        with closing(sqlite3.connect(destination / "lanterna.db")) as conn:
            assert conn.execute("SELECT id FROM campaigns").fetchall() == ids
            assert conn.execute("SELECT name FROM scenes").fetchone() == ("Recovered scene",)
        assert (destination / "uploads" / asset).read_bytes() == original[image]
        assert (destination / "gm_key.txt").read_bytes() == original[data_home / "gm_key.txt"]
        stopped(owner[0])
    settings_restored = dict(settings, LANTERNA_PORTABLE="0", LANTERNA_DATA_HOME=str(destination),
                             LANTERNA_REQUIRE_EXISTING="1")
    check = """
import sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
from fastapi.testclient import TestClient
from app.config import GM_KEY_FILE
from app.main import app
with TestClient(app) as client:
    key = GM_KEY_FILE.read_text(encoding='utf-8').strip()
    assert client.post('/api/gm/login', json={'key': key, 'name': 'Recovered GM', 'password': 'test-only-password'}).status_code == 200
    characters = client.get('/api/characters').json()
    assert any(item['id'] == 'smoke-character' for item in characters)
    scenes = client.get('/api/scenes').json()
    scene = client.get('/api/scenes/' + scenes[0]['id']).json()
    assert scene['name'] == 'Recovered scene'
    assert client.get(scene['background_url']).content == b'synthetic image'
"""
    restarted = subprocess.run([str(package / "python/python.exe"), "-X", "utf8", "-c", check,
                                str(package / "server")], cwd=temporary, env=settings_restored,
                               capture_output=True, encoding="utf-8", errors="replace", timeout=30)
    assert restarted.returncode == 0, restarted.stderr
    assert all(path.read_bytes() == content for path, content in original.items())
    if label == "profile":
        fail = """
import errno, os, sys
from pathlib import Path
sys.path.insert(0, sys.argv.pop(1))
from app import instance_restore
from app.backup_cli import main
mode = sys.argv.pop(1)
if mode == 'crash':
    instance_restore._publish = lambda *args: os._exit(73)
else:
    real_measure = instance_restore._measure
    def fail_during_copy(*args, **kwargs):
        if kwargs.get('target') is not None and kwargs['target'].parent.name == 'uploads':
            raise OSError(getattr(errno, mode), mode)
        return real_measure(*args, **kwargs)
    instance_restore._measure = fail_during_copy
raise SystemExit(main())
"""
        for mode, status in (("crash", 73), ("ENOSPC", 1), ("EACCES", 1)):
            failed_target = temporary / ("Отказ " + mode)
            failed = subprocess.run([str(package / "python/python.exe"), "-X", "utf8", "-c", fail,
                                     str(package / "server"), mode, "restore", str(copy), str(failed_target)],
                                    cwd=temporary, env=settings, capture_output=True, timeout=30)
            assert failed.returncode == status and not failed_target.exists()
            assert all(path.read_bytes() == content for path, content in original.items())
        assert "Restore: SUCCESS" in menu(package, *args, str(temporary / "Отказ crash"), settings=settings)
    (copy / "uploads" / asset).write_bytes(b"corrupt")
    menu(package, "-Action", "Verify", "-BackupPath", str(copy), settings=settings, succeeds=False)
    menu(package, *args, str(temporary / ("broken-" + label)), settings=settings, succeeds=False)
    assert not (temporary / ("broken-" + label)).exists()


backup_flow(replacement, home, env, "profile")
# The launcher supplies Portable to the CLI using its marker; only the child
# server needs the equivalent process setting.
backup_flow(portable, portable / "data", spare_env, "portable")
print("PASS: Windows Profile and Portable backup, verify, restore and startup")
