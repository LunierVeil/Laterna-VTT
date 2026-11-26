"""Startup tests in disposable application copies, independent of the checkout's data."""
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys

import pytest


_START = """
import asyncio
from app import main

if NO_INIT:
    def unexpected_init(*args):
        raise AssertionError('preflight attempted to initialize existing or invalid storage')
    main.init_db = unexpected_init
    main.initialize_file_db = unexpected_init

async def start():
    async with main.lifespan(main.app):
        assert main.is_gm_key(main.config.GM_KEY_FILE.read_text().strip())

asyncio.run(start())
"""


@pytest.fixture
def install(tmp_path):
    server = tmp_path / "package" / "server"
    source = Path(__file__).resolve().parents[1] / "app"
    shutil.copytree(source, server / "app", ignore=shutil.ignore_patterns("__pycache__"))
    home = tmp_path / "private profile"
    env = os.environ.copy()
    for name in ("DATABASE_URL", "UPLOAD_DIR", "GM_KEY_FILE", "LANTERNA_GM_KEY", "LANTERNA_PORTABLE"):
        env.pop(name, None)
    env.update(PYTHONPATH=str(server), LANTERNA_DATA_HOME=str(home), PYTHONDONTWRITEBYTECODE="1")
    return server, home, env


def launch(install, *, no_init=False, import_only=False):
    server, home, env = install
    code = "from app import main" if import_only else f"NO_INIT = {no_init!r}\n{_START}"
    return subprocess.run([sys.executable, "-c", code], cwd=server, env=env,
                          capture_output=True, text=True, timeout=20)


def snapshot(home):
    return {path.relative_to(home).as_posix(): path.read_bytes() if path.is_file() else None
            for path in home.rglob("*")}


def test_import_does_not_create_persistent_files(install):
    result = launch(install, import_only=True)
    assert result.returncode == 0, result.stderr
    assert not install[1].exists()


def test_first_run_then_existing_database_and_assets_preserved(install):
    result = launch(install)
    assert result.returncode == 0, result.stderr
    home = install[1]
    (home / "uploads" / "map.png").write_bytes(b"fixture")
    before = snapshot(home)
    result = launch(install, no_init=True)
    assert result.returncode == 0, result.stderr
    assert snapshot(home) == before
    assert {"lanterna.db", "uploads/map.png", "gm_key.txt"} <= before.keys()


@pytest.mark.parametrize("artifact", ["lanterna.db", "gm_key.txt", "uploads", "lanterna.db-wal"])
def test_legacy_artifacts_block_a_new_home(install, artifact):
    server, home, _ = install
    candidate = server / artifact
    if artifact == "uploads":
        candidate.mkdir()
    else:
        candidate.write_bytes(b"older data")
    before = snapshot(server)
    result = launch(install, no_init=True)
    assert result.returncode != 0
    assert "Найдены прежние данные" in result.stderr
    assert not home.exists()
    assert snapshot(server) == before


@pytest.mark.parametrize(("state", "message"), [
    ("corrupt", "SQLite не читается или повреждена"),
    ("legacy_schema", "Несовместимая схема SQLite"),
    ("missing_db", "отсутствует SQLite"),
    ("missing_key", "отсутствует uploads или ключ"),
    ("missing_uploads", "отсутствует uploads или ключ"),
    ("empty_key", "Файл ключа ГМ пуст"),
    ("journal", "журнал или WAL"),
    ("readonly", "Нет доступа на чтение и запись"),
])
def test_bad_existing_state_is_unchanged(install, state, message):
    home = install[1]
    home.mkdir()
    uploads = home / "uploads"
    key = home / "gm_key.txt"
    db = home / "lanterna.db"
    if state != "missing_uploads":
        uploads.mkdir()
    if state != "missing_key":
        key.write_text("" if state == "empty_key" else "synthetic-key", encoding="utf-8")
    if state == "legacy_schema":
        with sqlite3.connect(db) as conn:
            conn.execute("CREATE TABLE scenes (id TEXT PRIMARY KEY)")
    elif state != "missing_db":
        db.write_bytes(b"corrupt fixture")
    if state == "journal":
        (home / "lanterna.db-wal").write_bytes(b"journal")
    if state == "readonly":
        if os.name != "posix" or os.geteuid() == 0:
            pytest.skip("Permission check requires an unprivileged POSIX process")
        db.chmod(0o400)
    before = snapshot(home)
    result = launch(install, no_init=True)
    assert result.returncode != 0
    assert message in result.stderr
    assert snapshot(home) == before


def test_missing_parent_is_rejected_without_creating_directories(install):
    _, home, env = install
    env["LANTERNA_DATA_HOME"] = str(home / "extra" / "state")
    result = launch(install, no_init=True)
    assert result.returncode != 0
    assert "Родительский каталог хранилища отсутствует" in result.stderr
    assert not home.exists()


def test_regular_file_cannot_be_used_as_home(install):
    _, home, _ = install
    home.write_bytes(b"unrelated")
    result = launch(install, no_init=True)
    assert result.returncode != 0
    assert "Некорректный тип пути хранилища" in result.stderr
    assert home.read_bytes() == b"unrelated"


@pytest.mark.skipif(os.name != "posix", reason="Creating Windows symlinks requires additional privileges")
def test_symlink_cannot_redirect_first_run(install):
    _, home, _ = install
    other = home.parent / "other"
    other.mkdir()
    home.symlink_to(other, target_is_directory=True)
    result = launch(install, no_init=True)
    assert result.returncode != 0
    assert "Путь хранилища перенаправлен" in result.stderr
    assert not list(other.iterdir())


def test_conflicting_overrides_fail_without_creating_data(install):
    _, home, env = install
    env["UPLOAD_DIR"] = str(home / "elsewhere")
    result = launch(install, no_init=True)
    assert result.returncode != 0
    assert "cannot be combined with per-file overrides" in result.stderr
    assert not home.exists()


def test_engine_prevents_implicit_creation_when_database_disappears(install):
    server, home, env = install
    result = launch(install)
    assert result.returncode == 0, result.stderr
    (home / "lanterna.db").rename(home / "saved.db")
    code = """
import asyncio
from app.db import engine
async def connect():
    async with engine.connect():
        pass
asyncio.run(connect())
"""
    result = subprocess.run([sys.executable, "-c", code], cwd=server, env=env,
                            capture_output=True, text=True, timeout=20)
    assert result.returncode != 0
    assert "unable to open database file" in result.stderr
    assert not (home / "lanterna.db").exists()


@pytest.mark.skipif(not sys.platform.startswith("linux"), reason="Linux Alembic first-run path")
def test_linux_first_run_has_revision_and_active_scene(install):
    _, home, _ = install
    result = launch(install)
    assert result.returncode == 0, result.stderr
    with sqlite3.connect(home / "lanterna.db") as conn:
        version = conn.execute("SELECT name FROM sqlite_schema WHERE name = 'alembic_version'").fetchone()
        assert version == ("alembic_version",)
        assert conn.execute("SELECT version_num FROM alembic_version").fetchall() == [("0001_alpha_baseline",)]
        assert conn.execute("SELECT COUNT(*) FROM campaigns JOIN scenes ON scenes.id=campaigns.active_scene_id").fetchone() == (1,)
        assert conn.execute("PRAGMA foreign_key_check").fetchall() == []


@pytest.mark.parametrize("change", [
    "CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL, CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num)); INSERT INTO alembic_version VALUES ('9999_future')",
    "CREATE INDEX unexpected_index ON campaigns(name)",
    "PRAGMA user_version=42",
])
def test_existing_unknown_catalog_never_starts_or_changes_files(install, change):
    _, home, _ = install
    result = launch(install)
    assert result.returncode == 0, result.stderr
    with sqlite3.connect(home / "lanterna.db") as conn:
        conn.execute("DROP TABLE IF EXISTS alembic_version")
        conn.executescript(change)
    before = snapshot(home)
    result = launch(install, no_init=True)
    assert result.returncode != 0
    assert "Несовместимая схема SQLite" in result.stderr
    assert snapshot(home) == before


def test_existing_confirmed_alpha_is_never_stamped(install):
    _, home, _ = install
    result = launch(install)
    assert result.returncode == 0, result.stderr
    with sqlite3.connect(home / "lanterna.db") as conn:
        conn.execute("DROP TABLE IF EXISTS alembic_version")
    before = snapshot(home)
    result = launch(install, no_init=True)
    assert result.returncode == 0, result.stderr
    assert snapshot(home) == before


@pytest.mark.skipif(sys.platform != "linux", reason="Linux Alembic first-run path")
@pytest.mark.parametrize("abort", [
    "raise RuntimeError('injected seed failure')",
    "__import__('os')._exit(37)",
])
def test_incomplete_seed_is_never_served_after_error_or_process_crash(install, abort):
    server, home, env = install
    hook = (
        "from app import main\n"
        "original_seed = main._seed_demo_scene\n"
        "def abort_seed(db):\n"
        "    original_seed(db)\n"
        f"    {abort}\n"
        "main._seed_demo_scene = abort_seed\n"
    )
    result = subprocess.run([sys.executable, "-c", hook + "NO_INIT = False\n" + _START],
                            cwd=server, env=env, capture_output=True, text=True, timeout=20)
    if "._exit" in abort:
        assert result.returncode == 37, result.stderr
    else:
        assert result.returncode != 0 and "injected seed failure" in result.stderr
        uri = (home / "lanterna.db").as_uri() + "?mode=ro&immutable=1"
        with sqlite3.connect(uri, uri=True) as conn:
            assert conn.execute("SELECT name FROM sqlite_schema").fetchall() == []
    before = snapshot(home)
    result = launch(install, no_init=True)
    assert result.returncode != 0
    assert snapshot(home) == before


@pytest.mark.skipif(sys.platform != "linux", reason="Linux quiescent source path")
def test_crashed_writer_hot_journal_is_rejected_without_replay(install):
    from app.pre_upgrade import _require_known_schema
    from app.storage_lock import own_storage
    from app.data_home import resolve_storage
    from app.storage_preflight import StorageError

    server, home, env = install
    result = launch(install)
    assert result.returncode == 0, result.stderr
    database = home / "lanterna.db"
    with sqlite3.connect(database) as conn:
        conn.execute("DROP TABLE alembic_version")
        conn.execute("UPDATE campaigns SET name=hex(zeroblob(256000))")
    writer = """
import os
import sqlite3
import sys
conn=sqlite3.connect(sys.argv[1])
conn.execute("PRAGMA cache_size=4")
conn.execute("BEGIN IMMEDIATE")
conn.execute("UPDATE campaigns SET name=replace(name, '0', '1')")
os._exit(37)
"""
    result = subprocess.run([sys.executable, "-c", writer, str(database)], env=env, timeout=20)
    assert result.returncode == 37
    journal = home / "lanterna.db-journal"
    assert journal.read_bytes()[:8] == bytes.fromhex("d9d505f920a163d7")
    before = snapshot(home)
    paths = resolve_storage(env, server_dir=server, cwd=server)
    with own_storage(paths), pytest.raises(StorageError, match="незавершённый журнал"):
        _require_known_schema(database)
    result = launch(install, no_init=True)
    assert result.returncode != 0 and "журнал или WAL" in result.stderr
    assert snapshot(home) == before
