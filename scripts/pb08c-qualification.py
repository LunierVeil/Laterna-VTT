"""Run PB-08C only in a disposable, synthetic installation.

The Windows candidate gate is enabled only in this script's extracted ZIP.
The release checkout, package input, and real DataHomes are never used as
sources of data or modified.
"""
import argparse
from contextlib import closing
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tarfile
from tempfile import mkdtemp
import time
import zipfile

HISTORICAL = "4d2797d4589d42c11ac7e6fb6b13d338d011190f"
ROOT = Path(__file__).resolve().parents[1]
BOOT = """import asyncio
from app.db import engine
from app.main import app, lifespan
async def run():
    try:
        async with lifespan(app):
            pass
    finally:
        await engine.dispose()
asyncio.run(run())
"""
PAUSE = """
import sys,time
from app import alpha_upgrade, offline_cutover, pre_upgrade
point = sys.argv.pop(1)
def pause():
    print("PB08C_VM_CHECKPOINT " + point, flush=True)
    while True:
        time.sleep(1)
if point in ('before-source-fence', 'after-source-fence'):
    original = pre_upgrade._write_exclusive
    def write(path, payload):
        if path.name != pre_upgrade.FENCE:
            return original(path, payload)
        if point == 'before-source-fence':
            pause()
        result = original(path, payload)
        pre_upgrade._sync_directory(path.parent, pre_upgrade._directory_id(path.parent))
        pause()
    pre_upgrade._write_exclusive = write
elif point == 'staging':
    original = alpha_upgrade.stamp_alpha_staging
    def stamp(connection):
        original(connection)
        pause()
    alpha_upgrade.stamp_alpha_staging = stamp
elif point in ('before-target-publish', 'after-target-publish'):
    from app import instance_restore
    original = instance_restore._publish
    def publish(source, destination):
        if point == 'before-target-publish':
            pause()
        original(source, destination)
        pre_upgrade._sync_directory(destination.parent, pre_upgrade._directory_id(destination.parent))
        pause()
    instance_restore._publish = publish
elif point in ('activation', 'after-activation', 'recovery'):
    original = offline_cutover._write
    def write(path, value, **kwargs):
        if point == 'activation' and path.name == 'activation.json':
            pause()
        original(path, value, **kwargs)
        if ((point == 'after-activation' and path.name == 'activation.json')
                or (point == 'recovery' and path.name == 'recovery.json')):
            pause()
    offline_cutover._write = write
from app.migration_cli import main
raise SystemExit(main())
"""


def digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def inventory(home: Path) -> dict:
    names = [home / "lanterna.db", home / "gm_key.txt", *list((home / "uploads").glob("*"))]
    return {str(p.relative_to(home)): digest(p) for p in names if p.is_file()}


def clean_env(profile: Path) -> dict:
    env = {k: v for k, v in os.environ.items()
           if k not in {"DATABASE_URL", "UPLOAD_DIR", "GM_KEY_FILE", "PUBLIC_URL", "UVICORN_WORKERS", "WEB_CONCURRENCY"}
           and k.upper() != "PSMODULEPATH" and not k.startswith("LANTERNA_")}
    env.update(LOCALAPPDATA=str(profile), PYTHONUTF8="1", PYTHONDONTWRITEBYTECODE="1", LANTERNA_AUTO_BACKUP="0")
    return env


def execute(server: Path, env: dict, code: str, *arguments: str, success=True):
    python = (server.parent / "python" / "python.exe") if os.name == "nt" else Path(sys.executable)
    entry = "import sys; sys.path.insert(0, sys.argv.pop(1));\n" + code
    result = subprocess.run([str(python), "-X", "utf8", "-c", entry, str(server), *arguments],
                            cwd=server, env=env, capture_output=True, text=True,
                            encoding="utf-8", errors="replace", timeout=120)
    if (result.returncode == 0) != success:
        raise RuntimeError(f"Unexpected subprocess exit {result.returncode}\n{result.stderr[-4500:]}")
    return result


def shell(server: Path, env: dict, *args: str, success=True):
    if os.name == "nt":
        command = ["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
                   str(server.parent / "laterna.ps1"), *args]
    else:
        command = ["bash", str(server.parent / "laterna.sh"), *args]
    result = subprocess.run(command, cwd=server, env=env, capture_output=True, encoding="utf-8",
                            errors="replace", timeout=120)
    if (result.returncode == 0) != success:
        raise RuntimeError(f"Unexpected launcher exit {result.returncode}\n{result.stderr[-4500:]}")
    return result


def cli(server: Path, env: dict, *args: str, success=True):
    return execute(server, env, "from app.migration_cli import main\nraise SystemExit(main())", *args, success=success)


def sync_json(path: Path, value: dict):
    with path.open("x", encoding="utf-8") as stream:
        json.dump(value, stream)
        stream.flush()
        os.fsync(stream.fileno())


def unpack_windows_candidate(candidate: Path | None, application: Path):
    if candidate is None:
        raise ValueError("A Windows candidate ZIP is required")
    with zipfile.ZipFile(candidate) as archive:
        archive.extractall(application)
    platform = application / "server" / "app" / "cutover_platform.py"
    source = platform.read_text(encoding="utf-8")
    assert source.count("WINDOWS_UPGRADE_ACCEPTED = False") == 1
    platform.write_text(source.replace("WINDOWS_UPGRADE_ACCEPTED = False", "WINDOWS_UPGRADE_ACCEPTED = True"),
                        encoding="utf-8")


def provision(root: Path, candidate: Path | None, mode: str):
    alpha, beta, profile = (root / name for name in ("Alpha", "Beta", "Profile"))
    profile.mkdir()
    alpha.mkdir()
    beta.mkdir()
    if os.name == "nt":
        unpack_windows_candidate(candidate, beta)
        shutil.copytree(beta / "python", alpha / "python")
    else:
        (beta / "server").mkdir()
        shutil.copytree(ROOT / "server" / "app", beta / "server" / "app",
                        ignore=shutil.ignore_patterns("__pycache__"))
        shutil.copy2(ROOT / "laterna.sh", beta / "laterna.sh")
    files = ["server/app", "windows/laterna.bat", "windows/laterna.ps1", "laterna.sh"]
    historical = subprocess.check_output(["git", "archive", HISTORICAL, *files], cwd=ROOT)
    with tarfile.open(fileobj=io.BytesIO(historical)) as archive:
        archive.extractall(alpha, filter="data")
    if os.name == "nt":
        for name in ("laterna.bat", "laterna.ps1"):
            shutil.copyfile(alpha / "windows" / name, alpha / name)
    source = alpha / "server"
    destination = root / "PortableData" if mode == "Portable" else profile / "LaternaVTT"
    # The managed portable target is adjacent to the replaceable ZIP tree.
    env = clean_env(profile)
    if os.name == "nt":
        # Fail explicitly on unsupported native directory barriers.
        execute(beta / "server", env, """from pathlib import Path
from app.cutover_platform import windows_volume, windows_flush
root=Path(sys.argv[1])
assert windows_volume(root)
windows_flush(root)
""", str(root))
    execute(source, env, BOOT)
    (source / "uploads" / ("1" * 32 + ".png")).write_bytes(b"PB-08C synthetic media")
    sync_json(root / "fixture.json", {"original": inventory(source), "mode": mode})
    execute(beta / "server", env, """from pathlib import Path
from app.pre_upgrade import _directory_id, _sync_directory, _sync_file
root = Path(sys.argv[1])
source = root / 'Alpha' / 'server'
for path in (root / 'fixture.json', source / 'lanterna.db', source / 'gm_key.txt', *list((source / 'uploads').iterdir())):
    _sync_file(path)
for path in (source / 'uploads', source, source.parent, root / 'Beta' / 'server',
             root / 'Beta', root / 'Profile', root, root.parent):
    _sync_directory(path, _directory_id(path))
""", str(root))
    return beta / "server", source, destination, env


def paths(root: Path):
    evidence = json.loads((root / "fixture.json").read_text(encoding="utf-8"))
    profile = root / "Profile"
    beta = root / "Beta"
    destination = root / "PortableData" if evidence["mode"] == "Portable" else profile / "LaternaVTT"
    return beta / "server", root / "Alpha" / "server", destination, clean_env(profile), evidence


def prepare(server, source, destination, env):
    if os.name == "nt":
        shell(server, env, "-Action", "Upgrade", "-Upgrade", "Prepare", "-AlphaServer", str(source),
              "-Destination", str(destination))
    else:
        cli(server, env, "prepare", "--source", str(source), "--destination", str(destination))


def activate(server, env):
    if os.name == "nt":
        shell(server, env, "-Action", "Upgrade", "-Upgrade", "Activate")
    else:
        cli(server, env, "activate")


def confirmed_write(destination: Path):
    connection = sqlite3.connect(destination / "lanterna.db")
    try:
        connection.execute("PRAGMA synchronous=FULL")
        connection.execute("UPDATE campaigns SET name='PB08C confirmed'")
        assert connection.total_changes > 0
        connection.commit()
    finally:
        connection.close()


def verify_beta(server, destination, env, *, expect_record=False):
    selected = cli(server, env, "select").stdout.strip()
    assert Path(selected) == destination
    if os.name == "nt":
        launch = json.loads(shell(server, env, "-Action", "Paths").stdout.splitlines()[-1])
        assert Path(launch["home"]) == destination
    execute(server, {**env, "LANTERNA_DATA_HOME": str(destination)}, BOOT)
    with closing(sqlite3.connect(destination / "lanterna.db")) as db:
        assert db.execute("PRAGMA integrity_check").fetchall() == [("ok",)]
        assert db.execute("PRAGMA foreign_key_check").fetchall() == []
        assert db.execute("SELECT version_num FROM alembic_version").fetchone() == ("0001_alpha_baseline",)
        if expect_record:
            assert db.execute("SELECT name FROM campaigns").fetchone() == ("PB08C confirmed",)


RUNTIME = """import asyncio,socket,sys
from pathlib import Path
from app.main import app,lifespan
async def run():
    async with lifespan(app):
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0))
            listener.listen()
            Path(sys.argv[1]).write_text(str(listener.getsockname()[1]), encoding='ascii')
            await asyncio.to_thread(sys.stdin.readline)
asyncio.run(run())
"""


def check_runtime_exclusion(root, server, source, destination, env):
    marker = root / "unregistered-listener"
    python = server.parent / "python" / "python.exe" if os.name == "nt" else Path(sys.executable)
    argv = [str(python), "-X", "utf8", "-c", "import sys; sys.path.insert(0, sys.argv.pop(1));\n" + RUNTIME,
            str(server), str(marker)]
    with subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL,
                          stderr=subprocess.DEVNULL, cwd=server,
                          env={**env, "LANTERNA_DATA_HOME": str(root / "OtherDataHome")}) as process:
        try:
            deadline = time.monotonic() + 30
            while not marker.is_file() and process.poll() is None and time.monotonic() < deadline:
                time.sleep(.05)
            assert marker.is_file(), "Unregistered backend did not reach its listener"
            result = cli(server, env, "prepare", "--source", str(source),
                         "--destination", str(destination), success=False)
            assert "Установка занята" in result.stderr, result.stderr
            assert (source / "app").is_dir()
            assert not destination.exists()
        finally:
            process.stdin.close()
            try:
                process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=15)


INTERRUPTED_TRANSACTION = """import os,sqlite3,sys,time
db=sqlite3.connect(sys.argv[1])
assert db.execute("PRAGMA journal_mode=" + sys.argv[2]).fetchone()[0].upper() == sys.argv[2]
db.execute("PRAGMA synchronous=FULL")
db.execute("PRAGMA wal_autocheckpoint=0")
db.execute("PRAGMA cache_size=5")
db.execute("UPDATE campaigns SET name='PB08C confirmed'")
db.commit()
db.execute("BEGIN IMMEDIATE")
db.execute("UPDATE campaigns SET name=?", ('uncommitted' * 65536,))
if len(sys.argv) == 4:
    print("PB08C_VM_CHECKPOINT " + sys.argv[3], flush=True)
    while True:
        time.sleep(1)
os._exit(37)
"""


def check_replay(server, destination, env, mode):
    database = destination / "lanterna.db"
    result = execute(server, env, INTERRUPTED_TRANSACTION, str(database), mode, success=False)
    assert result.returncode == 37, result.stderr
    suffix = "-wal" if mode == "WAL" else "-journal"
    sidecar = destination / (database.name + suffix)
    assert sidecar.is_file()
    if mode == "DELETE":
        with sidecar.open("rb") as stream:
            assert stream.read(8) == bytes.fromhex("d9d505f920a163d7")
    before = digest(sidecar)
    cli(server, env, "recover")
    backups = list((server.parent.parent / f".{server.parent.name}.laterna-cutover").glob(
        f"sqlite-*/{database.name}{suffix}"))
    assert any(digest(path) == before for path in backups)
    verify_beta(server, destination, env, expect_record=True)


def check_rebind(root, server, destination, env):
    cli(server, env, "recover")
    unavailable = root / "RetainedBetaData"
    destination.rename(unavailable)
    cli(server, env, "select", success=False)
    restored = root / "ReboundData"
    if os.name == "nt":
        shell(server, env, "-Action", "Upgrade", "-Upgrade", "Rebind", "-Destination", str(restored))
    else:
        cli(server, env, "rebind", "--destination", str(restored))
    verify_beta(server, restored, env, expect_record=True)
    restored_files = inventory(restored)
    retained_files = inventory(unavailable)
    restored_files.pop("lanterna.db")
    retained_files.pop("lanterna.db")
    assert restored_files == retained_files


def trial(root, candidate, mode):
    server, source, destination, env = provision(root, candidate, mode)
    check_runtime_exclusion(root, server, source, destination, env)
    prepare(server, source, destination, env)
    assert inventory(destination)["gm_key.txt"] == inventory(source)["gm_key.txt"]
    execute(server, {**env, "LANTERNA_DATA_HOME": str(destination)}, BOOT, success=False)
    execute(source, env, BOOT, success=False)
    if os.name == "nt":
        assert not (source.parent / "laterna.bat").exists()
        shell(source, env, "-Action", "Paths", success=False)
    else:
        assert not (source.parent / "laterna.sh").exists()
    activate(server, env)
    verify_beta(server, destination, env)
    if os.name == "nt":
        confirmed_write(destination)
        previous = root / "PreviousZip"
        server.parent.rename(previous)
        unpack_windows_candidate(candidate, server.parent)
        verify_beta(server, destination, env, expect_record=True)
        print(f"PASS: {mode} active DataHome retained after replacing the Windows ZIP")
    for journal in ("DELETE", "WAL"):
        check_replay(server, destination, env, journal)
    check_rebind(root, server, destination, env)
    expected = json.loads((root / "fixture.json").read_text(encoding="utf-8"))["original"]
    assert inventory(source) == expected
    print(f"PASS: {mode} preparation, explicit activation, historic entries, startup, SQLite recovery, and rebind")


def launch_pause(root: Path, point: str):
    server, source, destination, env, _ = paths(root)
    sqlite_mode = {"sqlite-rollback": "DELETE", "sqlite-wal": "WAL"}.get(point)
    if sqlite_mode or point in {"activation", "after-activation", "recovery", "confirmed-write"}:
        prepare(server, source, destination, env)
    if sqlite_mode or point in {"recovery", "confirmed-write"}:
        activate(server, env)
    if point in {"recovery", "confirmed-write"}:
        confirmed_write(destination)
    if point == "confirmed-write":
        print("PB08C_VM_CHECKPOINT confirmed-write", flush=True)
        while True:
            time.sleep(1)
    python = server.parent / "python" / "python.exe" if os.name == "nt" else Path(sys.executable)
    if sqlite_mode:
        subprocess.run([str(python), "-X", "utf8", "-c", INTERRUPTED_TRANSACTION,
                        str(destination / "lanterna.db"), sqlite_mode, point],
                       cwd=server, env=env, check=True)
        raise RuntimeError("SQLite checkpoint exited without interruption")
    argv = [str(python), "-X", "utf8", "-c", "import sys; sys.path.insert(0, sys.argv.pop(1));\n" + PAUSE,
            str(server), point]
    if point in {"activation", "after-activation"}:
        argv += ["activate"]
    elif point == "recovery":
        argv += ["recover"]
    else:
        argv += ["prepare", "--source", str(source), "--destination", str(destination)]
    subprocess.run(argv, cwd=server, env=env, check=True)


def verify_restart(root: Path, point: str):
    server, source, destination, env, evidence = paths(root)
    assert inventory(source) == evidence["original"]
    if point in {"after-activation", "confirmed-write"}:
        verify_beta(server, destination, env, expect_record=point == "confirmed-write")
    elif point in {"sqlite-rollback", "sqlite-wal"}:
        cli(server, env, "recover")
        verify_beta(server, destination, env, expect_record=True)
    elif point == "recovery":
        execute(server, {**env, "LANTERNA_DATA_HOME": str(destination)}, BOOT, success=False)
        cli(server, env, "recover")
        verify_beta(server, destination, env, expect_record=True)
    else:
        if point == "activation":
            assert cli(server, env, "status").stdout.strip() == "HOLD"
            cli(server, env, "cancel", success=False)
        execute(server, {**env, "LANTERNA_DATA_HOME": str(destination)}, BOOT, success=False)
    execute(server, {**env, "LANTERNA_DATA_HOME": str(source)}, BOOT, success=False)
    print(f"PASS: post-restart invariants for {point}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--zip", type=Path)
    parser.add_argument("--scratch", type=Path, required=True)
    parser.add_argument("--mode", choices=("Profile", "Portable"), default="Profile")
    parser.add_argument("--pause", choices=("before-source-fence", "after-source-fence", "staging",
                        "before-target-publish", "after-target-publish", "activation",
                        "after-activation", "confirmed-write", "sqlite-rollback", "sqlite-wal", "recovery"))
    parser.add_argument("--resume", type=Path)
    args = parser.parse_args()
    if args.resume:
        if not args.pause or args.resume.parent.resolve() != args.scratch.resolve() or not args.resume.name.startswith("pb08c-"):
            parser.error("--resume requires a previous fixture and its --pause")
        verify_restart(args.resume, args.pause)
        return
    root = Path(mkdtemp(prefix="pb08c-", dir=args.scratch))
    print(f"PB08C_VM_FIXTURE {root}", flush=True)
    if args.pause:
        provision(root, args.zip, args.mode)
        launch_pause(root, args.pause)
    else:
        try:
            trial(root, args.zip, args.mode)
        finally:
            shutil.rmtree(root)


if __name__ == "__main__":
    main()
