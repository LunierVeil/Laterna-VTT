import errno
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import os
from contextlib import closing

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app import instance_backup as core
from app.data_home import resolve_storage
from app.db import Base
from app.models import Campaign, Scene
from app.storage_lock import own_storage
from app.upload_files import publish_upload
from .test_storage_preflight import install  # noqa: F401


@pytest.fixture
def storage(tmp_path):
    home = tmp_path / "Исходные данные"
    home.mkdir()
    paths = resolve_storage({"LANTERNA_DATA_HOME": str(home)}, server_dir=tmp_path, cwd=tmp_path)
    Path(paths.uploads).mkdir()
    Path(paths.gm_key).write_text("fixture-key", encoding="utf-8")
    engine = create_engine(paths.database_url.set(drivername="sqlite"))
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        campaign = Campaign(name="Original")
        session.add(campaign)
        session.flush()
        scene = Scene(campaign_id=campaign.id, name="Original scene")
        session.add(scene)
        session.flush()
        campaign.active_scene_id = scene.id
        session.commit()
    engine.dispose()
    schema = {table.name: set(table.columns.keys()) for table in Base.metadata.sorted_tables}
    return paths, schema


def create(storage, target, **kwargs):
    paths, schema = storage
    with own_storage(paths):
        return core.create_backup(paths, target, schema, external_key=kwargs.pop("external_key", False), **kwargs)


def test_backup_wal_snapshot_and_unicode_media(storage, tmp_path, monkeypatch):
    paths, schema = storage
    upload = Path(paths.uploads) / ("1" * 32 + ".png")
    publish_upload(upload.parent, upload.name, b"image")
    target = tmp_path / "Проверенная копия"
    real_snapshot = core._snapshot
    with closing(sqlite3.connect(paths.database_url.database)) as live:
        assert live.execute("PRAGMA journal_mode=WAL").fetchone() == ("wal",)
        live.execute("UPDATE scenes SET background_url=?", ("/uploads/" + upload.name,))
        live.commit()
        live.execute("UPDATE scenes SET name='Uncommitted'")
        assert Path(paths.database_url.database + "-wal").is_file()

        def snapshot_then_publish(source, output, deadline):
            version = real_snapshot(source, output, deadline)
            publish_upload(upload.parent, "Поздний.webp", b"later")
            return version

        monkeypatch.setattr(core, "_snapshot", snapshot_then_publish)
        manifest = create(storage, target)
        assert live.execute("SELECT name FROM scenes").fetchone() == ("Uncommitted",)
        live.rollback()
    assert core.verify_backup(target, schema) == manifest
    assert (target / "uploads" / upload.name).read_bytes() == b"image"
    assert (target / "gm_key.txt").read_text() == "fixture-key"
    assert "fixture-key" not in (target / "manifest.json").read_text()
    with closing(sqlite3.connect(target / "lanterna.db")) as conn:
        assert conn.execute("SELECT name,background_url FROM scenes").fetchone() == (
            "Original scene", "/uploads/" + upload.name,
        )


def test_external_secret_is_not_copied(storage, tmp_path):
    target = tmp_path / "backup"
    manifest = create(storage, target, external_key=True)
    assert manifest["key_mode"] == "external"
    assert not (target / "gm_key.txt").exists()
    assert core.verify_backup(target, storage[1]) == manifest


@pytest.mark.parametrize("fault", [errno.ENOSPC, errno.EACCES, errno.EIO])
def test_copy_error_never_publishes_and_preserves_source(storage, tmp_path, monkeypatch, fault):
    good = tmp_path / "good-copy"
    create(storage, good)
    target = tmp_path / "backup"
    paths, schema = storage
    before = Path(paths.database_url.database).read_bytes()
    real_measure = core._measure

    def inject(path, deadline, *, target=None, limit=core.MAX_BYTES):
        if target is not None:
            target.write_bytes(b"partial")
            raise OSError(fault, "injected")
        return real_measure(path, deadline, limit=limit)

    monkeypatch.setattr(core, "_measure", inject)
    with pytest.raises(core.BackupError, match="Не удалось подготовить"):
        create(storage, target)
    assert not target.exists()
    assert not list(tmp_path.glob(".laterna-backup-*"))
    assert Path(paths.database_url.database).read_bytes() == before
    assert core.verify_backup(good, schema)["complete"]


def test_repeated_destination_refused(storage, tmp_path):
    target = tmp_path / "backup"
    manifest = create(storage, target)
    with pytest.raises(core.BackupError, match="уже занято"):
        create(storage, target)
    assert core.verify_backup(target, storage[1]) == manifest


@pytest.mark.parametrize("change", ["bytes", "missing", "extra", "version", "duplicate", "size", "hash", "path"])
def test_verify_rejects_modified_bundle(storage, tmp_path, change):
    target = tmp_path / "backup"
    data = create(storage, target)
    manifest = target / "manifest.json"
    if change == "bytes":
        (target / "gm_key.txt").write_bytes(b"changed-key")
    elif change == "missing":
        (target / "gm_key.txt").unlink()
    elif change == "extra":
        (target / "extra").touch()
    elif change == "version":
        data["version"] = 2
    elif change == "duplicate":
        manifest.write_text(manifest.read_text().replace('"version": 1', '"version": 1, "version": 1'))
    elif change == "size":
        data["files"]["gm_key.txt"]["size"] += 10
    elif change == "hash":
        data["files"]["gm_key.txt"]["sha256"] = "bad"
    elif change == "path":
        data["files"]["../escape"] = data["files"].pop("gm_key.txt")
    if change in ("version", "size", "hash", "path"):
        manifest.write_text(json.dumps(data))
    with pytest.raises(core.BackupError):
        core.verify_backup(target, storage[1])


def test_foreign_key_violation_refuses_publication(storage, tmp_path):
    paths, _ = storage
    with closing(sqlite3.connect(paths.database_url.database)) as db:
        db.execute("UPDATE scenes SET campaign_id='missing'")
        db.commit()
    target = tmp_path / "backup"
    with pytest.raises(core.BackupError, match="foreign_key_check"):
        create(storage, target)
    assert not target.exists()


def test_missing_referenced_asset_refuses_publication(storage, tmp_path):
    paths, _ = storage
    with closing(sqlite3.connect(paths.database_url.database)) as db:
        db.execute("UPDATE scenes SET background_url=?", ("/uploads/" + "1" * 32 + ".png",))
        db.commit()
    target = tmp_path / "backup"
    with pytest.raises(core.BackupError, match="отсутствующее изображение"):
        create(storage, target)
    assert not target.exists()


def test_exclusive_writer_times_out_without_publication(storage, tmp_path):
    paths, _ = storage
    with closing(sqlite3.connect(paths.database_url.database)) as writer:
        writer.execute("BEGIN EXCLUSIVE")
        target = tmp_path / "blocked"
        with pytest.raises(core.BackupError):
            create(storage, target, timeout=.15)
        writer.rollback()
    assert not target.exists()
    assert not list(tmp_path.glob(".laterna-backup-*"))


def test_live_lifespan_allows_commits_and_upload_during_backup(install, tmp_path):
    server, _, env = install
    script = r"""
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from pathlib import Path
from threading import Event
import sqlite3
import sys
from fastapi.testclient import TestClient
from app import config, instance_backup as core, main

snapshot_ready = Event()
continue_backup = Event()
real_snapshot = core._snapshot

def interleave(source, output, deadline):
    version = real_snapshot(source, output, deadline)
    snapshot_ready.set()
    assert continue_backup.wait(10)
    return version

core._snapshot = interleave
target = Path(sys.argv[1])
with TestClient(main.app) as client, ThreadPoolExecutor(max_workers=1) as pool:
    key = config.GM_KEY_FILE.read_text().strip()
    login = client.post("/api/gm/login", json={"key": key, "name": "Master", "password": "test-password"})
    assert login.status_code == 200
    backup = pool.submit(client.portal.call, main.app.state.instance_backup.create, target)
    try:
        assert snapshot_ready.wait(10)
        response = client.post("/api/uploads", content=b"\x89PNG\r\n\x1a\nfixture")
        assert response.status_code == 200
        name = response.json()["url"].split("/")[-1]
        with closing(sqlite3.connect(config.DATABASE_URL.database)) as writer:
            before = writer.execute("SELECT name FROM scenes LIMIT 1").fetchone()
            writer.execute("UPDATE scenes SET name='After snapshot'")
            writer.commit()
    finally:
        continue_backup.set()
    assert backup.result(timeout=15)["complete"]
assert (target / "uploads" / name).read_bytes().endswith(b"fixture")
with closing(sqlite3.connect(target / "lanterna.db")) as snapshot:
    assert snapshot.execute("SELECT name FROM scenes LIMIT 1").fetchone() == before
"""
    result = subprocess.run([sys.executable, "-c", script, str(tmp_path / "online")],
                            cwd=server, env=env, capture_output=True, text=True, timeout=25)
    assert result.returncode == 0, result.stderr


def test_interrupted_before_atomic_publication_keeps_previous_backup(storage, tmp_path):
    paths, schema = storage
    previous = tmp_path / "previous"
    baseline = create(storage, previous)
    destination = tmp_path / "interrupted"
    before = Path(paths.database_url.database).read_bytes()
    script = """
import os, sys
from pathlib import Path
from app import instance_backup as core
from app.config import STORAGE_PATHS
from app.db import Base
from app import models
from app.storage_lock import own_storage
core._publish = lambda *_: os._exit(23)
schema = {table.name: set(table.columns.keys()) for table in Base.metadata.sorted_tables}
with own_storage(STORAGE_PATHS):
    core.create_backup(STORAGE_PATHS, Path(sys.argv[1]), schema, external_key=False)
"""
    server = Path(__file__).resolve().parents[1]
    env = dict(os.environ, PYTHONPATH=str(server), LANTERNA_DATA_HOME=str(paths.data_home))
    for name in ("DATABASE_URL", "UPLOAD_DIR", "GM_KEY_FILE", "LANTERNA_GM_KEY", "LANTERNA_PORTABLE"):
        env.pop(name, None)
    result = subprocess.run([sys.executable, "-c", script, str(destination)], cwd=tmp_path,
                            env=env, capture_output=True, text=True, timeout=20)
    assert result.returncode == 23, result.stderr
    assert not destination.exists()
    assert Path(paths.database_url.database).read_bytes() == before
    assert core.verify_backup(previous, schema) == baseline
    assert create(storage, destination)["complete"]


def test_verified_hash_does_not_substitute_for_sqlite_check(storage, tmp_path):
    import hashlib

    target = tmp_path / "backup"
    manifest = create(storage, target)
    damaged = b"not a SQLite database"
    (target / "lanterna.db").write_bytes(damaged)
    manifest["files"]["lanterna.db"] = {"size": len(damaged), "sha256": hashlib.sha256(damaged).hexdigest()}
    (target / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    with pytest.raises(core.BackupError, match="проверить резервную копию"):
        core.verify_backup(target, storage[1])


def test_empty_destination_created_by_competitor_is_not_replaced(storage, tmp_path, monkeypatch):
    target = tmp_path / "backup"
    publish = core._publish

    def compete(staging, destination):
        destination.mkdir()
        publish(staging, destination)

    monkeypatch.setattr(core, "_publish", compete)
    with pytest.raises(core.BackupError):
        create(storage, target)
    assert target.is_dir() and not list(target.iterdir())
    assert not list(tmp_path.glob(".laterna-backup-*"))


def test_changed_source_is_detected_during_copy(storage, tmp_path, monkeypatch):
    from contextlib import contextmanager

    paths, _ = storage
    upload = Path(paths.uploads) / "changing.png"
    upload.write_bytes(b"original")
    regular = core._regular_file

    @contextmanager
    def mutate(path):
        with regular(path) as stream:
            yield stream
            if path == upload:
                path.write_bytes(b"changed during copy")

    monkeypatch.setattr(core, "_regular_file", mutate)
    target = tmp_path / "backup"
    with pytest.raises(core.BackupError, match="Файл изменился"):
        create(storage, target)
    assert not target.exists()


def test_many_uploads_only_include_published_files(storage, tmp_path):
    paths, schema = storage
    for i in range(64):
        publish_upload(Path(paths.uploads), f"{i:032x}.png", bytes([i]))
    (Path(paths.uploads) / (core.UPLOAD_TEMP + "interrupted")).write_bytes(b"partial")
    target = tmp_path / "backup"
    manifest = create(storage, target)
    assert len(manifest["files"]) == 66
    assert core.verify_backup(target, schema) == manifest


@pytest.mark.skipif(os.name != "posix", reason="Creating Windows symlinks requires additional privileges")
def test_verify_rejects_redirected_upload_file(storage, tmp_path):
    paths, schema = storage
    publish_upload(Path(paths.uploads), "image.png", b"fixture")
    target = tmp_path / "backup"
    create(storage, target)
    blob = target / "uploads/image.png"
    blob.unlink()
    blob.symlink_to(Path(paths.uploads) / "image.png")
    with pytest.raises(core.BackupError):
        core.verify_backup(target, schema)
