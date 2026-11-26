import asyncio
from collections import namedtuple
from contextlib import closing
from dataclasses import replace
import errno
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys

import pytest

from app import automatic_backup as auto, instance_backup as core
from app.data_home import resolve_storage
from app.instance_restore import restore_backup
from app.storage_lock import own_storage
from app.storage_preflight import StorageError
from .test_instance_backup import storage  # noqa: F401
from .test_storage_preflight import install  # noqa: F401

Disk = namedtuple("Disk", "total used free")


@pytest.fixture
def series(storage, monkeypatch):
    paths, schema = storage
    monkeypatch.setattr(shutil, "disk_usage", lambda _: Disk(50 * auto.GIB, 0, 50 * auto.GIB))
    return auto.BackupSeries(core.OnlineBackup(paths, schema, external_key=False), auto.BackupPolicy())


def create(series, now):
    with own_storage(series.backup.paths):
        destination, workspace, state = series.reserve(now)
        try:
            manifest = core.create_backup(series.backup.paths, destination, series.backup.schema,
                                          external_key=series.backup.external_key, workspace=workspace)
        finally:
            series.finish(state, now)
    return destination, manifest


def test_policy_and_virtual_clock():
    policy = auto.BackupPolicy.from_env({})
    assert policy.reserve(5 * auto.GIB) == 2 * auto.GIB
    assert policy.reserve(50 * auto.GIB) == 5 * auto.GIB
    assert policy.reserve(200 * auto.GIB) == 10 * auto.GIB
    assert [auto.startup_wait(policy, last, 200_000) for last in (None, 100, 190_000, 300_000)] == [
        300, 300, 76_400, 300,
    ]
    assert [auto.retry_wait(policy, failures) for failures in range(1, 7)] == [
        1800, 3600, 7200, 14400, 21600, 21600,
    ]
    assert auto.BackupPolicy.from_env({"LANTERNA_AUTO_BACKUP_MAX_COUNT": "3"}).max_count == 3
    with pytest.raises(core.BackupError):
        auto.BackupPolicy.from_env({"LANTERNA_AUTO_BACKUP_MAX_COUNT": "0"})


def test_scheduler_virtual_wait_one_run_per_wake_and_backoff(series, monkeypatch):
    encountered = []
    clock = 200_000
    calls = 0

    async def wait(stop, delay, get_clock, deadline):
        nonlocal clock
        encountered.append((delay, deadline))
        if len(encountered) == 4:
            stop.set()
            return False
        clock += 4 * 86400  # sleep or forward jump

        return True

    original = series.backup.create

    async def create_with_contention(*args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise core.BackupBusy("manual worker is active")
        return await original(*args, **kwargs)

    async def run():
        monkeypatch.setattr(series.backup, "create", create_with_contention)
        with own_storage(series.backup.paths):
            await auto.serve_automatic_backups(series.backup, series.policy, asyncio.Event(),
                                               clock=lambda: clock, wait=wait)
            await series.backup.close()

    asyncio.run(run())
    assert calls == 3
    assert [delay for delay, _ in encountered] == [300, 1800, 86400, 86400]
    assert encountered[2][1] is not None
    assert len(series.load()["copies"]) == 2


@pytest.mark.parametrize("limit", ["count", "age", "volume"])
def test_prunes_only_registered_copies_and_restores_survivor(series, tmp_path, limit):
    manual = tmp_path / "Laterna Backups"
    before_upgrade = tmp_path / "Pre-upgrade"
    for protected in (manual, before_upgrade):
        protected.mkdir()
        (protected / "sentinel").write_text("keep")
    first, _ = create(series, 1000)
    second, manifest = create(series, 2000)
    options = {"count": {"max_count": 1}, "age": {"max_age": 900},
               "volume": {"max_bytes": 1}}
    series.policy = replace(series.policy, **options[limit])
    series.prune(series.load(), 3000)
    assert not first.exists()
    assert core.verify_backup(second, series.backup.schema) == manifest
    assert restore_backup(second, tmp_path / "Восстановленный стол", series.backup.schema) == manifest
    for protected in (manual, before_upgrade):
        assert (protected / "sentinel").read_text() == "keep"


@pytest.mark.parametrize("newest", ["corrupt", "external"])
def test_unusable_new_copy_cannot_displace_working_copy(series, newest):
    older, _ = create(series, 1000)
    series.backup.external_key = newest == "external"
    later, _ = create(series, 2000)
    if newest == "corrupt":
        (later / "lanterna.db").write_bytes(b"bad")
    series.policy = replace(series.policy, max_count=1)
    if newest == "corrupt":
        with pytest.raises(core.BackupError):
            series.prune(series.load(), 2000)
        assert later.exists()
    else:
        series.prune(series.load(), 2000)
        assert not later.exists()
    assert core.verify_backup(older, series.backup.schema)["key_mode"] == "file"


@pytest.mark.parametrize("error", [errno.ENOSPC, errno.EACCES, errno.EIO])
def test_write_failures_preserve_last_verified_backup(series, monkeypatch, error):
    old, original_manifest = create(series, 1000)
    source_db = Path(series.backup.paths.database_url.database)
    before = source_db.read_bytes()

    def fail(source, destination, deadline, **kwargs):
        destination.write_bytes(b"partial")
        raise OSError(error, "synthetic write failure")

    monkeypatch.setattr(core, "_snapshot", fail)
    with pytest.raises(core.BackupError):
        create(series, 2000)
    assert core.verify_backup(old, series.backup.schema) == original_manifest
    assert source_db.read_bytes() == before
    assert series.load()["pending"] is None
    assert not list(series.root.glob("work-*"))


def test_disk_reserve_and_logical_budget_block_writes(series, monkeypatch):
    old, manifest = create(series, 1000)
    monkeypatch.setattr(shutil, "disk_usage", lambda _: Disk(20 * auto.GIB, 0, 2 * auto.GIB))
    with pytest.raises(core.BackupError, match="Недостаточно места"):
        create(series, 2000)
    monkeypatch.setattr(shutil, "disk_usage", lambda _: Disk(20 * auto.GIB, 0, 2 * auto.GIB + core.MAX_MANIFEST + 2))
    with pytest.raises(core.BackupError, match="SQLite превышает"):
        create(series, 2000)
    assert core.verify_backup(old, series.backup.schema) == manifest
    assert len(series.load()["copies"]) == 1


@pytest.mark.parametrize("kind", ["unknown", "replaced", "symlink"])
def test_unproven_directory_never_deleted(series, tmp_path, kind):
    old, _ = create(series, 1000)
    new, _ = create(series, 2000)
    series.policy = replace(series.policy, max_count=1)
    foreign = tmp_path / "foreign"
    foreign.mkdir()
    (foreign / "note").write_text("keep")
    redirected = series.root / "unknown"
    if kind == "unknown":
        shutil.copytree(foreign, redirected)
    elif kind == "replaced":
        old.rename(tmp_path / "moved")
        shutil.copytree(foreign, old)
    else:
        old.rename(tmp_path / "moved")
        try:
            old.symlink_to(foreign, target_is_directory=True)
        except OSError:
            pytest.skip("symlinks unavailable on this platform")
    with pytest.raises((core.BackupError, StorageError)):
        series.prune(series.load(), 2000)
    assert (foreign / "note").read_text() == "keep"
    assert new.exists()
    assert ((redirected if kind == "unknown" else old) / "note").read_text() == "keep"


def test_portable_move_gets_a_separate_series(series, tmp_path):
    older, _ = create(series, 1000)
    home = Path(series.backup.paths.data_home)
    relocated = tmp_path / "Перемещённый ZIP"
    relocated.mkdir()
    home.rename(relocated / "data")
    paths = resolve_storage({"LANTERNA_PORTABLE": "1"}, server_dir=relocated / "server", cwd=tmp_path)
    moved = auto.BackupSeries(core.OnlineBackup(paths, series.backup.schema, external_key=False), series.policy)
    assert moved.root != series.root and moved.load()["copies"] == {}
    assert core.verify_backup(older, series.backup.schema)["complete"]


@pytest.mark.parametrize("published", [False, True])
def test_process_crash_around_publication(series, tmp_path, published):
    old, _ = create(series, 1000)
    script = """
import os, sys
from pathlib import Path
from app import instance_backup as core, automatic_backup as auto
from app.config import STORAGE_PATHS
from app.db import Base
from app import models
from app.storage_lock import own_storage
real_publish = core._publish
def interrupt(staging, destination):
    if sys.argv[1] == 'True':
        real_publish(staging, destination)
    os._exit(73)
core._publish = interrupt
schema = {table.name: set(table.columns.keys()) for table in Base.metadata.sorted_tables}
policy = auto.BackupPolicy(reserve_min=1, reserve_max=1)
series = auto.BackupSeries(core.OnlineBackup(STORAGE_PATHS, schema, external_key=False), policy)
with own_storage(STORAGE_PATHS):
    dst, workspace, _ = series.reserve(2000)
    core.create_backup(STORAGE_PATHS, dst, schema, external_key=False, workspace=workspace)
"""
    server = Path(__file__).resolve().parents[1]
    env = dict(os.environ, PYTHONPATH=str(server), LANTERNA_DATA_HOME=str(series.backup.paths.data_home))
    for name in ("DATABASE_URL", "UPLOAD_DIR", "GM_KEY_FILE", "LANTERNA_GM_KEY", "LANTERNA_PORTABLE"):
        env.pop(name, None)
    result = subprocess.run([sys.executable, "-c", script, str(published)], cwd=tmp_path,
                            env=env, capture_output=True, text=True, timeout=20)
    assert result.returncode == 73, result.stderr
    with own_storage(series.backup.paths):
        state = series.load()
    assert len(state["copies"]) == (2 if published else 1)
    assert state["pending"] is None and not list(series.root.glob("work-*"))
    assert core.verify_backup(old, series.backup.schema)["complete"]
    assert create(series, 3000)[1]["complete"]


def test_real_lifespan_automatic_backup_shares_manual_slot_and_allows_http_ws(install, tmp_path):
    server, home, env = install
    script = r"""
import json, os, sys
from pathlib import Path
from threading import Event
from fastapi.testclient import TestClient
from app import automatic_backup as auto, instance_backup as core, main
from app.instance_restore import restore_backup

ready, release, published = Event(), Event(), Event()
snapshot = core._snapshot
publish = core._publish

def interleave(source, output, deadline, **kwargs):
    version = snapshot(source, output, deadline, **kwargs)
    ready.set()
    assert release.wait(10)
    return version

def observe(staging, destination):
    publish(staging, destination)
    published.set()

core._snapshot = interleave
core._publish = observe
with TestClient(main.app) as client:
    try:
        assert ready.wait(10)
        service = main.app.state.instance_backup
        with __import__('pytest').raises(core.BackupBusy):
            client.portal.call(service.create, Path(sys.argv[1]) / 'manual')
        key = main.config.GM_KEY_FILE.read_text().strip()
        assert client.post('/api/gm/login', json={'key': key, 'name': 'Master', 'password': 'test-password'}).status_code == 200
        scene = client.get('/api/scenes').json()[0]['id']
        with client.websocket_connect('/ws/scene/' + scene) as ws:
            ws.send_json({'type': 'cmd', 'id': 'rename', 'name': 'scene.rename',
                          'payload': {'id': scene, 'name': 'During automatic backup'}})
            for _ in range(20):
                result = ws.receive_json()
                if result.get('cmd_id') == 'rename':
                    assert result['type'] == 'reply', result
                    break
            else:
                raise AssertionError('missing scene rename response')
        upload = client.post('/api/uploads', content=b'\x89PNG\r\n\x1a\nfixture')
        assert upload.status_code == 200, upload.text
    finally:
        release.set()
    assert published.wait(10)
# The lifecycle drains and confirms the publication before releasing ownership.
series = auto.BackupSeries(service, auto.BackupPolicy())
backup, = series.root.glob('backup-*')
manifest = core.verify_backup(backup, service.schema)
assert manifest['complete'] and any(name.startswith('uploads/') for name in manifest['files'])
restored = Path(sys.argv[1]) / 'restored'
assert restore_backup(backup, restored, service.schema) == manifest
assert (restored / 'gm_key.txt').read_bytes() == main.config.GM_KEY_FILE.read_bytes()
"""
    env.update(LANTERNA_AUTO_BACKUP_STARTUP_DELAY="1", LANTERNA_AUTO_BACKUP_RESERVE_MIN="1",
               LANTERNA_AUTO_BACKUP_RESERVE_MAX="1", LANTERNA_AUTO_BACKUP="1")
    result = subprocess.run([sys.executable, "-c", script, str(tmp_path)], cwd=server, env=env,
                            capture_output=True, text=True, timeout=35)
    assert result.returncode == 0, result.stderr


def test_reparse_point_rejected_during_inventory(series, tmp_path, monkeypatch):
    import stat
    from types import SimpleNamespace

    old, _ = create(series, 1000)
    original = Path.lstat

    def lstat(path):
        info = original(path)
        if path == old:
            return SimpleNamespace(st_mode=info.st_mode, st_file_attributes=stat.FILE_ATTRIBUTE_REPARSE_POINT)
        return info

    with monkeypatch.context() as patch:
        patch.setattr(Path, "lstat", lstat)
        with pytest.raises(StorageError):
            series.load()
    assert core.verify_backup(old, series.backup.schema)["complete"]


def test_shutdown_waits_for_inflight_worker(series, tmp_path, monkeypatch):
    from threading import Event

    ready = Event()
    release = Event()
    snapshot = core._snapshot

    def pause(*args, **kwargs):
        ready.set()
        assert release.wait(5)
        return snapshot(*args, **kwargs)

    async def run():
        monkeypatch.setattr(core, "_snapshot", pause)
        stop = asyncio.Event()

        async def instant(*args):
            return True

        with own_storage(series.backup.paths):
            task = asyncio.create_task(auto.serve_automatic_backups(series.backup, series.policy, stop, wait=instant))
            try:
                assert await asyncio.to_thread(ready.wait, 5)
                stop.set()
                assert not task.done()
                with pytest.raises(core.BackupBusy):
                    await series.backup.create(tmp_path / "manual")
                with pytest.raises(StorageError, match="занято"):
                    with own_storage(series.backup.paths):
                        pytest.fail("the active backup must retain ownership")
            finally:
                release.set()
            await asyncio.wait_for(task, 10)
            await series.backup.close()

    asyncio.run(run())
    assert len(series.load()["copies"]) == 1


def test_clock_reversal_preserves_latest_publication(series):
    previous, _ = create(series, 4000)
    newest, _ = create(series, 1000)
    series.policy = replace(series.policy, max_count=1)
    series.prune(series.load(), 2000)
    assert newest.exists() and not previous.exists()


def test_renamed_candidate_is_not_erased_after_quarantine_race(series, tmp_path, monkeypatch):
    original, _ = create(series, 1000)
    survivor, _ = create(series, 2000)
    series.policy = replace(series.policy, max_count=1)
    original_name = tmp_path / "displaced"
    real_publish = auto._publish

    def replace_candidate(source, target):
        source.rename(original_name)
        source.mkdir()
        (source / "foreign").write_text("untouched")
        real_publish(source, target)

    monkeypatch.setattr(auto, "_publish", replace_candidate)
    with pytest.raises(core.BackupError, match="карантин"):
        series.prune(series.load(), 2000)
    quarantined, = series.root.glob("trash-*")
    assert (quarantined / "foreign").read_text() == "untouched"
    assert core.verify_backup(original_name, series.backup.schema)["complete"]
    assert core.verify_backup(survivor, series.backup.schema)["complete"]


def test_retention_write_failure_keeps_survivor_and_halts(series, monkeypatch):
    old, _ = create(series, 1000)
    survivor, manifest = create(series, 2000)
    series.policy = replace(series.policy, max_count=1)
    real_unlink = os.unlink

    def denied(path, *args, **kwargs):
        raise PermissionError(errno.EACCES, "synthetic retention error")

    with monkeypatch.context() as patch:
        patch.setattr(os, "unlink", denied)
        with pytest.raises(PermissionError):
            series.prune(series.load(), 2000)
    assert os.unlink is real_unlink
    assert not old.exists()  # candidate is still intact in quarantine
    quarantined, = series.root.glob("trash-*")
    assert core.verify_backup(quarantined, series.backup.schema)["complete"]
    assert core.verify_backup(survivor, series.backup.schema) == manifest
    with pytest.raises(core.BackupError):
        series.reserve(3000)


def test_external_series_stops_at_count_without_deleting_copies(series):
    series.backup.external_key = True
    series.policy = replace(series.policy, max_count=2)
    first, first_manifest = create(series, 1000)
    second, second_manifest = create(series, 2000)
    journal = series.root / "series.json"
    before = journal.read_bytes()

    with own_storage(series.backup.paths):
        with pytest.raises(core.BackupError, match="Внешний ключ не подтверждает"):
            series.reserve(3000)
        series.policy = replace(series.policy, max_age=1000)
        with pytest.raises(core.BackupError, match="Пригодная копия с файловым ключом не подтверждена"):
            series.reserve(3000)

    assert journal.read_bytes() == before
    assert set(series.root.iterdir()) == {journal, first, second}
    for path, manifest in ((first, first_manifest), (second, second_manifest)):
        assert core.verify_backup(path, series.backup.schema) == manifest
        assert manifest["key_mode"] == "external"
        assert not (path / "gm_key.txt").exists()


@pytest.mark.parametrize("phase", ["partial_unlink", "after_unlink", "before_pending"])
def test_interrupted_series_can_be_preserved_and_replaced_offline(series, tmp_path, monkeypatch, phase):
    old, _ = create(series, 1000)
    survivor, manifest = create(series, 2000)
    if phase != "before_pending":
        series.policy = replace(series.policy, max_count=1)
    journal = series.root / "series.json"
    before = journal.read_bytes()

    def fail_write(state):
        raise OSError(errno.ENOSPC, "synthetic journal write fault")

    def partial_unlink(quarantine, identity, snapshot):
        (quarantine / "lanterna.db").unlink()
        raise PermissionError(errno.EACCES, "synthetic partial retention fault")

    with own_storage(series.backup.paths), monkeypatch.context() as patch:
        if phase == "partial_unlink":
            patch.setattr(series, "_unlink_files", partial_unlink)
        else:
            patch.setattr(series, "_write", fail_write)
        with pytest.raises(OSError, match="synthetic"):
            series.reserve(3000)

    assert journal.read_bytes() == before
    if phase == "before_pending":
        assert old.exists()
        work, = series.root.glob("work-*")
        assert (work / "snapshot" / "uploads").is_dir()
    else:
        assert not old.exists()
        if phase == "partial_unlink":
            quarantine, = series.root.glob("trash-*")
            with pytest.raises(core.BackupError):
                core.verify_backup(quarantine, series.backup.schema)
        else:
            assert not list(series.root.glob("trash-*"))

    restarted = auto.BackupSeries(series.backup, series.policy)
    with own_storage(series.backup.paths):
        with pytest.raises(core.BackupError, match="неизвестный|отсутствуют зарегистрированные"):
            restarted.reserve(3000)

    destination = tmp_path / "Recovery drill"
    assert restore_backup(survivor, destination, series.backup.schema) == manifest
    archived = tmp_path / "Preserved series"
    series.root.rename(archived)
    fresh = auto.BackupSeries(series.backup, series.policy)
    published, created = create(fresh, 4000)
    assert core.verify_backup(published, series.backup.schema) == created
    assert (archived / journal.name).read_bytes() == before
    assert core.verify_backup(archived / survivor.name, series.backup.schema) == manifest


def test_incompatible_registered_copy_cannot_replace_last_compatible_survivor(series):
    compatible, manifest = create(series, 1000)
    incompatible, bad_manifest = create(series, 2000)
    database = incompatible / "lanterna.db"
    with closing(sqlite3.connect(database)) as conn, conn:
        conn.execute("CREATE TABLE alembic_version ( version_num VARCHAR(32) NOT NULL, "
                     "CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num) )")
        conn.execute("INSERT INTO alembic_version VALUES ('future_revision')")
    data = database.read_bytes()
    bad_manifest["files"]["lanterna.db"] = {"size": len(data), "sha256": hashlib.sha256(data).hexdigest()}
    (incompatible / "manifest.json").write_text(json.dumps(bad_manifest))

    # Simulate a copy published and registered by an older Verify contract.
    state = series.load()
    receipt = state["copies"][incompatible.name.removeprefix("backup-")]
    receipt["digest"] = auto._manifest_digest(bad_manifest)
    receipt["bytes"] = sum((incompatible / name).stat().st_size for name in bad_manifest["files"])
    receipt["bytes"] += (incompatible / "manifest.json").stat().st_size
    series._write(state)

    series.policy = replace(series.policy, max_count=1)
    with pytest.raises(core.BackupError, match="Несовместимая схема SQLite"):
        series.prune(series.load(), 2000)
    assert core.verify_backup(compatible, series.backup.schema) == manifest
    assert database.read_bytes() == data
    assert len(series.load()["copies"]) == 2
