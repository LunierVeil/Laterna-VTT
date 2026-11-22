"""Run against extracted Windows ZIPs using the bundled Python."""
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import shutil
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
assert key not in menu(replacement, "-Action", "Backup")
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
