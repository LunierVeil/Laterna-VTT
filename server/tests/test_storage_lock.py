"""Real subprocesses, with all storage and retained lock files under tmp_path."""

from contextlib import contextmanager
import os
from pathlib import Path
import subprocess
import sys
import time

from .test_storage_preflight import install, snapshot  # noqa: F401 (isolated package fixture)


_CHILD = """
import asyncio

from pathlib import Path
import socket
import sys
from app import main
from app.storage_lock import own_storage

ready, mode = sys.argv[1:]
if mode == "init_failure":
    async def fail():
        raise RuntimeError("synthetic initialization failure")
    def fail_file(*args):
        raise RuntimeError("synthetic initialization failure")
    main.initialize_file_db = fail_file
    main.init_db = fail

async def run():
    if mode == "lock":
        with own_storage(main.config.STORAGE_PATHS):
            return
    async with main.lifespan(main.app):
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            listener.listen()
            marker = Path(ready)
            staging = marker.with_suffix(".tmp")
            staging.write_text(str(listener.getsockname()[1]))
            staging.replace(marker)
            await asyncio.to_thread(sys.stdin.readline)

asyncio.run(run())
"""


def _start(install, name, mode="serve", env=None):
    server, home, defaults = install
    ready = home.parent / f"{name}.ready"
    proc = subprocess.Popen(
        [sys.executable, "-c", _CHILD, str(ready), mode],
        cwd=server, env=defaults if env is None else env,
        stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
        text=True,
    )
    return proc, ready


@contextmanager
def child(install, name, mode="serve", env=None):
    proc, ready = _start(install, name, mode, env)
    try:
        yield proc, ready
    finally:
        if proc.poll() is None:
            proc.kill()
        proc.communicate(timeout=10)


def _ready(proc, marker):
    deadline = time.monotonic() + 15
    while not marker.exists() and proc.poll() is None and time.monotonic() < deadline:
        time.sleep(.025)
    assert marker.exists(), proc.stderr.read() if proc.poll() is not None else "startup timed out"
    return int(marker.read_text())


def _refused(proc, message):
    _, error = proc.communicate(timeout=15)
    assert proc.returncode != 0
    assert message in error


def test_live_owner_blocks_overrides_and_independent_home_can_listen(install):
    _, home, env = install
    with child(install, "first") as (first, marker):
        first_port = _ready(first, marker)
        before = snapshot(home)
        overrides = dict(env)
        overrides.pop("LANTERNA_DATA_HOME")
        overrides.update(
            DATABASE_URL=f"sqlite+aiosqlite:///{home.as_posix()}/./lanterna.db",
            UPLOAD_DIR=str(home / "uploads"), GM_KEY_FILE=str(home / "gm_key.txt"),
        )
        with child(install, "second", env=overrides) as (second, second_marker):
            _refused(second, "Хранилище уже занято")
            assert not second_marker.exists()
        assert snapshot(home) == before
        with child(install, "other", env=dict(env, LANTERNA_DATA_HOME=str(home.with_name("other")))) as (other, other_marker):
            assert _ready(other, other_marker) != first_port
        assert first.communicate("\n", timeout=10)[1] == ""
        assert first.returncode == 0
    assert list(home.parent.glob(".laterna-*.lock"))
    with child(install, "restarted") as (proc, marker):
        _ready(proc, marker)
        assert snapshot(home) == before
        proc.kill()
        proc.wait(timeout=10)
    with child(install, "after-crash") as (proc, marker):
        _ready(proc, marker)
        assert snapshot(home) == before


def test_concurrent_first_start_has_one_owner(install):
    with child(install, "race-one") as one, child(install, "race-two") as two:
        deadline = time.monotonic() + 15
        while all(proc.poll() is None for proc, _ in (one, two)) and time.monotonic() < deadline:
            time.sleep(.025)
        lost = [proc for proc, _ in (one, two) if proc.poll() is not None]
        assert len(lost) == 1
        _refused(lost[0], "Хранилище уже занято")
        winner = next((proc, marker) for proc, marker in (one, two) if proc not in lost)
        _ready(*winner)


def test_failed_start_releases_lock_without_replacing_partial_database(install):
    _, home, _ = install
    with child(install, "init-error", mode="init_failure") as (proc, _):
        _refused(proc, "synthetic initialization failure")
    before = snapshot(home)
    assert before["lanterna.db"] == b""
    assert ("gm_key.txt" in before) == (sys.platform == "linux")
    with child(install, "invalid") as (proc, _):
        _refused(proc, "Несовместимая схема" if sys.platform == "linux" else "Неполное хранилище")
    assert snapshot(home) == before
    with child(install, "lock-after-error", mode="lock") as (proc, _):
        _, error = proc.communicate(timeout=15)
        assert proc.returncode == 0, error


def test_different_databases_cannot_share_uploads_or_key(install):
    _, home, env = install
    with child(install, "owner") as (owner, marker):
        _ready(owner, marker)
        before = snapshot(home)
        overrides = dict(env)
        overrides.pop("LANTERNA_DATA_HOME")
        other = home.with_name("another")
        other.mkdir()
        overrides["DATABASE_URL"] = f"sqlite+aiosqlite:///{(other / 'test.db').as_posix()}"
        for shared, uploads, key in (
            ("uploads", home / "uploads", other / "gm_key.txt"),
            ("key", other / "uploads", home / "gm_key.txt"),
        ):
            overrides.update(UPLOAD_DIR=str(uploads), GM_KEY_FILE=str(key))
            with child(install, shared, env=overrides) as (contender, _):
                _refused(contender, "Хранилище уже занято")
            assert not list(other.iterdir())
        assert snapshot(home) == before
