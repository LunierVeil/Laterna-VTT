import errno
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
from contextlib import closing
from types import SimpleNamespace

import pytest

from app import automatic_backup as auto, instance_backup as backup, pre_upgrade as gate
from app.data_home import resolve_storage
from app.instance_restore import restore_backup
from app.storage_lock import own_storage
from .test_instance_backup import storage  # noqa: F401
from .test_storage_preflight import snapshot  # noqa: F401


@pytest.fixture
def offline(storage, tmp_path, monkeypatch):
    paths, schema = storage
    # Exercise real fsync even when the test runner uses tmpfs. Separate
    # tests exercise the real mount admission check without this override.
    monkeypatch.setattr(gate, "_mount_id", lambda path: 1)
    monkeypatch.setattr(shutil, "disk_usage", lambda _: SimpleNamespace(total=10 * 1024**3, free=10 * 1024**3))
    return paths, schema, tmp_path


def invoke(offline, action, *, env=None):
    paths, _, root = offline
    return gate.run_pre_upgrade(paths, server_dir=root, cwd=root, env=env or {},
                                target_revision="future-test-revision", apply=action)


def never_apply(_):
    pytest.fail("a rejected upgrade called the writer")


def test_verified_snapshot_precedes_writer_and_can_restore(offline):
    paths, schema, root = offline
    home = Path(paths.data_home)
    (home / "uploads" / "image.png").write_bytes(b"image")
    original = snapshot(home)
    with closing(sqlite3.connect(paths.database_url.database)) as db:
        source_dump = list(db.iterdump())

    def apply(result):
        assert snapshot(home) == {**original, gate.FENCE: result.receipt.read_bytes()}
        receipt = json.loads(result.receipt.read_bytes())
        assert receipt["attempt_id"] == result.attempt_id
        assert receipt["manifest_sha256"] == result.manifest_sha256
        assert receipt["source_revision"] == gate.SOURCE_REVISION
        assert receipt["target_revision"] == "future-test-revision"
        assert backup.verify_backup(result.snapshot, schema)["complete"]
        with pytest.raises(gate.UpgradeBlocked, match="разрешено"):
            gate.assert_no_pending_upgrade(paths)
        with closing(sqlite3.connect(paths.database_url.database)) as db:
            db.execute("UPDATE scenes SET name='test write'")
            db.commit()

    result = invoke(offline, apply)
    destination = root / "Restored data"
    restore_backup(result.snapshot, destination, schema)
    restored = snapshot(destination)
    assert {k: v for k, v in restored.items() if k != "lanterna.db"} == {
        k: v for k, v in original.items() if k != "lanterna.db"
    }
    with closing(sqlite3.connect(destination / "lanterna.db")) as db:
        assert list(db.iterdump()) == source_dump
    with pytest.raises(gate.UpgradeBlocked, match="разрешено"):
        invoke(offline, never_apply)


@pytest.mark.parametrize("kind", ["manifest", "sqlite", "directory", "after_verify"])
def test_tampering_blocks_writer(offline, monkeypatch, kind):
    paths, _, root = offline
    home = Path(paths.data_home)
    before = snapshot(home)
    original_create = gate.create_backup
    original_verify = gate.verify_backup

    def create(*args, **kwargs):
        manifest = original_create(*args, **kwargs)
        destination = args[1]
        if kind == "manifest":
            (destination / "manifest.json").write_text("{}")
        elif kind == "sqlite":
            (destination / "lanterna.db").write_bytes(b"broken")
        elif kind == "directory":
            destination.rename(root / "displaced")
            destination.mkdir()
            (destination / "foreign").write_text("keep")
        return manifest

    def verify(destination, schema):
        manifest = original_verify(destination, schema)
        if kind == "after_verify":
            (destination / "lanterna.db").write_bytes(b"modified after verify")
        return manifest

    monkeypatch.setattr(gate, "create_backup", create)
    monkeypatch.setattr(gate, "verify_backup", verify)
    with pytest.raises(gate.UpgradeBlocked):
        invoke(offline, never_apply)
    assert snapshot(home) == before
    if kind == "directory":
        foreign, = root.glob(".laterna-pre-upgrade-*/*/snapshot/foreign")
        assert foreign.read_text() == "keep"


@pytest.mark.parametrize("number", [errno.ENOSPC, errno.EACCES, errno.EIO])
@pytest.mark.parametrize("phase", ["create", "sync"])
def test_io_failure_keeps_live_data(offline, monkeypatch, number, phase):
    paths, _, _ = offline
    home = Path(paths.data_home)
    before = snapshot(home)

    def fail(*args, **kwargs):
        raise OSError(number, "synthetic fault")

    monkeypatch.setattr(gate, "create_backup" if phase == "create" else "_sync_directory", fail)
    with pytest.raises(gate.UpgradeBlocked):
        invoke(offline, never_apply)
    assert snapshot(home) == before


def test_low_space_and_occupied_datahome_fail_closed(offline, monkeypatch):
    paths, _, root = offline
    before = snapshot(Path(paths.data_home))
    with own_storage(paths):
        with pytest.raises(gate.UpgradeBlocked, match="занято"):
            invoke(offline, never_apply)
    monkeypatch.setattr(shutil, "disk_usage", lambda _: SimpleNamespace(free=1))
    with pytest.raises(gate.UpgradeBlocked, match="Недостаточно места"):
        invoke(offline, never_apply)
    assert snapshot(Path(paths.data_home)) == before
    assert not list(root.glob(".laterna-pre-upgrade-*"))


@pytest.mark.parametrize("sql", ["PRAGMA user_version=2", "CREATE TABLE unknown(id INTEGER)",
                                 "CREATE TRIGGER unknown AFTER INSERT ON scenes BEGIN SELECT 1; END"])
def test_unknown_and_future_schema_fails_closed(offline, sql):
    paths, _, root = offline
    with closing(sqlite3.connect(paths.database_url.database)) as db:
        db.execute(sql)
        db.commit()
    before = snapshot(Path(paths.data_home))
    with pytest.raises(gate.UpgradeBlocked, match="неизвестна"):
        invoke(offline, never_apply)
    assert snapshot(Path(paths.data_home)) == before
    assert not list(root.glob(".laterna-pre-upgrade-*"))


def test_key_custody_is_required(offline):
    paths, _, _ = offline
    with pytest.raises(gate.UpgradeBlocked, match="внешнего ключа"):
        invoke(offline, never_apply, env={"LANTERNA_GM_KEY": "test secret"})
    Path(paths.gm_key).unlink()
    before = snapshot(Path(paths.data_home))
    with pytest.raises(gate.UpgradeBlocked, match="отсутствует uploads или ключ"):
        invoke(offline, never_apply)
    assert snapshot(Path(paths.data_home)) == before


def test_automatic_retention_leaves_pre_upgrade_snapshot(offline):
    paths, schema, _ = offline
    result = invoke(offline, lambda _: None)
    service = backup.OnlineBackup(paths, schema, external_key=False)
    series = auto.BackupSeries(service, auto.BackupPolicy(max_count=1, reserve_min=1, reserve_max=1))
    with own_storage(paths):
        for now in (1000, 2000):
            destination, workspace, state = series.reserve(now)
            backup.create_backup(paths, destination, schema, external_key=False, workspace=workspace)
            series.finish(state, now)
    assert len(series.load()["copies"]) == 1
    assert backup.verify_backup(result.snapshot, schema)["complete"]


@pytest.mark.parametrize("phase", ["before_publish", "after_publish", "writer"])
def test_real_process_crash_requires_safe_retry(offline, phase):
    paths, _, root = offline
    home = Path(paths.data_home)
    before = snapshot(home)
    script = """
import os, sys
from pathlib import Path
from types import SimpleNamespace
from app import config, pre_upgrade as gate, instance_backup as backup
gate._mount_id = lambda path: 1
gate.shutil.disk_usage = lambda path: SimpleNamespace(total=10 * 1024**3, free=10 * 1024**3)
phase = sys.argv[1]
publish = backup._publish
def halt(staging, destination):
    if phase == 'after_publish':
        publish(staging, destination)
    os._exit(73)
if phase != 'writer':
    backup._publish = halt
def apply(result):
    assert result.receipt.exists()
    os._exit(73)
gate.run_pre_upgrade(config.STORAGE_PATHS, server_dir=config.SERVER_DIR,
                     cwd=Path.cwd(), env=os.environ, target_revision='future-test', apply=apply)
"""
    server = Path(__file__).resolve().parents[1]
    env = dict(os.environ, PYTHONPATH=str(server), LANTERNA_DATA_HOME=str(home))
    for name in ("DATABASE_URL", "UPLOAD_DIR", "GM_KEY_FILE", "LANTERNA_GM_KEY", "LANTERNA_PORTABLE"):
        env.pop(name, None)
    child = subprocess.run([sys.executable, "-c", script, phase], env=env, cwd=root,
                           capture_output=True, text=True, timeout=20)
    assert child.returncode == 73, child.stderr
    observed = snapshot(home)
    observed.pop(gate.FENCE, None)
    assert observed == before
    published = list(root.glob(".laterna-pre-upgrade-*/*/snapshot"))
    assert bool(published) == (phase != "before_publish")
    if phase == "writer":
        with pytest.raises(gate.UpgradeBlocked, match="разрешено"):
            invoke(offline, never_apply)
        started = subprocess.run([sys.executable, "-c", """
import asyncio
from app import main
async def start():
    async with main.lifespan(main.app):
        raise AssertionError('a fenced DataHome must not start')
asyncio.run(start())
"""], env=env, cwd=root, capture_output=True, text=True, timeout=20)
        assert started.returncode != 0 and "Нужна проверенная процедура" in started.stderr
    else:
        assert invoke(offline, lambda _: None).snapshot not in published


def test_mount_rejection_blocks_before_snapshot(storage, tmp_path, monkeypatch):
    paths, schema = storage
    before = snapshot(Path(paths.data_home))
    monkeypatch.setattr(gate.sys, "platform", "win32")
    with pytest.raises(gate.UpgradeBlocked, match="Долговечность"):
        # Exercise the platform gate directly; PB-05 selects OS locks by os.name.
        invoke((paths, schema, tmp_path), never_apply)
    assert snapshot(Path(paths.data_home)) == before


def test_real_linux_mount_and_durability(storage, tmp_path):
    paths, schema = storage
    try:
        gate._mount_id(tmp_path)
    except gate.UpgradeBlocked as exc:
        pytest.skip(str(exc))
    result = invoke((paths, schema, tmp_path), lambda _: None)
    assert result.receipt.is_file()
    assert backup.verify_backup(result.snapshot, schema)["complete"]
    restored = tmp_path / "Восстановленный экземпляр"
    restore_backup(result.snapshot, restored, schema)
    server = Path(__file__).resolve().parents[1]
    env = dict(os.environ, PYTHONPATH=str(server), LANTERNA_DATA_HOME=str(restored),
               LANTERNA_AUTO_BACKUP="0", LANTERNA_REQUIRE_EXISTING="1")
    for name in ("DATABASE_URL", "UPLOAD_DIR", "GM_KEY_FILE", "LANTERNA_GM_KEY", "LANTERNA_PORTABLE"):
        env.pop(name, None)
    process = subprocess.run([sys.executable, "-c", """
import asyncio
from app import main
async def start():
    async with main.lifespan(main.app):
        assert main.roles.is_gm_key('fixture-key')
asyncio.run(start())
"""], cwd=tmp_path, env=env, capture_output=True, text=True, timeout=20)
    assert process.returncode == 0, process.stderr


def test_fence_fsync_failure_preserves_source_and_prevents_retry(offline, monkeypatch):
    import stat

    paths, _, _ = offline
    home = Path(paths.data_home)
    before = snapshot(home)
    real_fsync = os.fsync
    directory_identity = home.stat()

    def fail_at_fence_directory(fd):
        file = os.fstat(fd)
        if stat.S_ISDIR(file.st_mode) and os.path.samestat(file, directory_identity):
            raise OSError(errno.EIO, "synthetic fence sync failure")
        return real_fsync(fd)

    monkeypatch.setattr(os, "fsync", fail_at_fence_directory)
    with pytest.raises(gate.UpgradeBlocked, match="synthetic fence sync failure"):
        invoke(offline, never_apply)
    after = snapshot(home)
    assert gate.FENCE in after
    assert {key: value for key, value in after.items() if key != gate.FENCE} == before
    with pytest.raises(gate.UpgradeBlocked, match="разрешено"):
        invoke(offline, never_apply)


def test_corrupt_source_does_not_create_snapshot(offline):
    paths, _, root = offline
    database = Path(paths.database_url.database)
    database.write_bytes(b"corrupt source")
    before = snapshot(Path(paths.data_home))
    with pytest.raises(gate.UpgradeBlocked):
        invoke(offline, never_apply)
    assert snapshot(Path(paths.data_home)) == before
    assert not list(root.glob(".laterna-pre-upgrade-*"))


def test_writer_error_retains_fence_and_snapshot(offline):
    paths, schema, _ = offline
    published = []

    def fail(result):
        published.append(result.snapshot)
        raise RuntimeError("writer interrupted")

    with pytest.raises(RuntimeError, match="writer interrupted"):
        invoke(offline, fail)
    assert backup.verify_backup(published[0], schema)["complete"]
    with pytest.raises(gate.UpgradeBlocked, match="разрешено"):
        invoke(offline, never_apply)


def test_replaced_receipt_with_same_contents_does_not_authorize(offline, monkeypatch):
    paths, _, root = offline
    original_sync = gate._sync_directory

    def sync(path, identity):
        original_sync(path, identity)
        if path == Path(paths.data_home):
            receipt, = root.glob(".laterna-pre-upgrade-*/*/receipt.json")
            replacement = receipt.with_name("replacement")
            replacement.write_bytes(receipt.read_bytes())
            replacement.replace(receipt)

    monkeypatch.setattr(gate, "_sync_directory", sync)
    with pytest.raises(gate.UpgradeBlocked, match="Запись подтверждения"):
        invoke(offline, never_apply)
