import errno
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
from contextlib import closing

import pytest
from argon2 import PasswordHasher
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app import instance_restore as restore
from app.data_home import resolve_storage
from app.instance_backup import BackupError, verify_backup
from app.models import Campaign, Character, Scene, Token, User
from .test_instance_backup import create, storage  # noqa: F401
from .test_storage_preflight import install, snapshot  # noqa: F401


@pytest.fixture
def bundle(storage, tmp_path):
    target = tmp_path / "backup"
    create(storage, target)
    return target, storage[1]


def _child(install, script, *args, **settings):
    server, _, env = install
    return subprocess.run([sys.executable, "-c", script, *map(str, args)], cwd=server,
                          env=dict(env, **settings), capture_output=True, text=True, timeout=25)


@pytest.mark.parametrize("external", [False, True])
def test_wal_backup_restores_and_starts_with_original_accounts(storage, install, tmp_path, external):
    paths, schema = storage
    asset = "a" * 32 + ".png"
    (Path(paths.uploads) / asset).write_bytes(b"synthetic image")
    engine = create_engine(paths.database_url.set(drivername="sqlite"))
    with Session(engine) as session:
        campaign = session.query(Campaign).one()
        scene = session.get(Scene, campaign.active_scene_id)
        scene.background_url = "/uploads/" + asset
        hashed = PasswordHasher().hash("fixture-password")
        gm = User(campaign_id=campaign.id, name="Master", password_hash=hashed, is_gm=True)
        player = User(campaign_id=campaign.id, name="Player", password_hash=hashed)
        session.add_all([gm, player])
        session.flush()
        character = Character(campaign_id=campaign.id, owner_id=player.id, name="Hero")
        session.add(character)
        session.flush()
        token = Token(scene_id=scene.id, character_id=character.id, owner_id=player.id)
        session.add(token)
        session.flush()
        ids = [campaign.id, scene.id, character.id, token.id, gm.id, player.id]
        session.commit()
    engine.dispose()
    target = tmp_path / "Снимок"
    with closing(sqlite3.connect(paths.database_url.database)) as live:
        assert live.execute("PRAGMA journal_mode=WAL").fetchone() == ("wal",)
        live.execute("UPDATE scenes SET name='Committed in WAL'")
        live.commit()
        assert Path(paths.database_url.database + "-wal").is_file()
        create(storage, target, external_key=external)
    before_source = snapshot(Path(paths.data_home))
    before_backup = snapshot(target)
    destination = tmp_path / "Восстановленный стол"
    key = "fixture-key"
    if external:
        with pytest.raises(BackupError, match="LANTERNA_GM_KEY"):
            restore.restore_backup(target, destination, schema)
        assert not destination.exists()
    result = restore.restore_backup(target, destination, schema, external_gm_key=key if external else None)
    assert verify_backup(target, schema) == result
    assert snapshot(destination) == {k: v for k, v in before_backup.items() if k != "manifest.json"}
    script = """
import json, os, sys
from contextlib import closing
import sqlite3
from fastapi.testclient import TestClient
from app import main

async def reject():
    raise AssertionError('restore must not initialize a new database or campaign')

main.init_db = main.ensure_demo_scene = reject
campaign, scene, character, token, gm, player = json.loads(sys.argv[1])
with TestClient(main.app) as client:
    key = os.getenv('LANTERNA_GM_KEY') or main.config.GM_KEY_FILE.read_text().strip()
    assert client.post('/api/gm/login', json={'key': key}).json()['id'] == gm
    response = client.get('/api/scenes/' + scene)
    assert response.status_code == 200
    data = response.json()
    assert data['name'] == 'Committed in WAL'
    assert any(t['id'] == token and t['character_id'] == character for t in data['tokens'])
    assert client.get(data['background_url']).content == b'synthetic image'
    assert client.post('/api/login', json={'name':'Player','password':'fixture-password'}).json()['id'] == player
with closing(sqlite3.connect(main.config.DATABASE_URL.database)) as conn:
    assert conn.execute('SELECT id FROM campaigns').fetchall() == [(campaign,)]
    assert conn.execute('SELECT id FROM characters').fetchall() == [(character,)]
"""
    settings = {"LANTERNA_DATA_HOME": str(destination), "LANTERNA_EXPERIMENTAL_VISIBILITY": "0"}
    if external:
        failed = _child(install, script, json.dumps(ids), **settings)
        assert failed.returncode != 0 and "отсутствует uploads или ключ" in failed.stderr
        assert not (destination / "gm_key.txt").exists()
        settings["LANTERNA_GM_KEY"] = key
    launched = _child(install, script, json.dumps(ids), **settings)
    assert launched.returncode == 0, launched.stderr
    assert snapshot(Path(paths.data_home)) == before_source
    assert snapshot(target) == before_backup


@pytest.mark.parametrize("change", ["manifest", "missing", "corrupt", "unsafe", "schema_version"])
def test_invalid_backup_rejected_before_writing(bundle, tmp_path, change):
    import hashlib
    source, schema = bundle
    manifest_path = source / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    if change == "manifest":
        manifest_path.write_text("{")
    elif change == "missing":
        (source / "gm_key.txt").unlink()
    elif change == "unsafe":
        manifest["files"]["../escape"] = manifest["files"].pop("gm_key.txt")
        manifest_path.write_text(json.dumps(manifest))
    else:
        db = source / "lanterna.db"
        if change == "schema_version":
            with closing(sqlite3.connect(db)) as conn:
                conn.execute("PRAGMA user_version=9")
            manifest["sqlite_user_version"] = 9
        else:
            db.write_bytes(b"corrupt")
        data = db.read_bytes()
        manifest["files"]["lanterna.db"] = {"size": len(data), "sha256": hashlib.sha256(data).hexdigest()}
        manifest_path.write_text(json.dumps(manifest))
    before = snapshot(tmp_path)
    with pytest.raises(BackupError):
        restore.restore_backup(source, tmp_path / "destination", schema)
    assert snapshot(tmp_path) == before


@pytest.mark.parametrize("number", [errno.ENOSPC, errno.EACCES, errno.EIO])
def test_partial_copy_error_leaves_no_datahome(bundle, tmp_path, monkeypatch, number):
    source, schema = bundle
    before = snapshot(source)
    original = restore._measure
    calls = 0

    def fail(file, deadline, *, target, limit):
        nonlocal calls
        calls += 1
        if calls == 2:
            target.write_bytes(b"partial")
            raise OSError(number, "injected")
        return original(file, deadline, target=target, limit=limit)

    monkeypatch.setattr(restore, "_measure", fail)
    destination = tmp_path / "destination"
    with pytest.raises(BackupError, match="injected"):
        restore.restore_backup(source, destination, schema)
    assert not destination.exists()
    assert not list(tmp_path.glob(".laterna-restore-*"))
    assert snapshot(source) == before


def test_repeat_restore_does_not_replace_data(bundle, tmp_path):
    source, schema = bundle
    destination = tmp_path / "destination"
    restore.restore_backup(source, destination, schema)
    before = snapshot(destination)
    with pytest.raises(BackupError, match="уже существует"):
        restore.restore_backup(source, destination, schema)
    assert snapshot(destination) == before


def test_source_change_after_verify_rejected(bundle, tmp_path, monkeypatch):
    source, schema = bundle
    verify = restore.verify_backup

    def change(directory, *args, **kwargs):
        result = verify(directory, *args, **kwargs)
        if directory == source:
            file = source / "gm_key.txt"
            file.write_bytes(b"x" * file.stat().st_size)
        return result

    monkeypatch.setattr(restore, "verify_backup", change)
    with pytest.raises(BackupError, match="изменился после проверки"):
        restore.restore_backup(source, tmp_path / "destination", schema)
    assert not (tmp_path / "destination").exists()


def test_killed_restore_and_live_storage_lock(bundle, install, tmp_path):
    source, schema = bundle
    destination = tmp_path / "destination"
    original = snapshot(source)
    script = """
import os, sys, time
from pathlib import Path
from app import instance_restore as restore, models
from app.db import Base
def hold(*_):
    Path(sys.argv[3]).touch()
    time.sleep(30)
restore._publish = hold
schema = {table.name: set(table.columns.keys()) for table in Base.metadata.sorted_tables}
restore.restore_backup(Path(sys.argv[1]), Path(sys.argv[2]), schema)
"""
    server, _, env = install
    ready = tmp_path / "ready"
    proc = subprocess.Popen([sys.executable, "-c", script, str(source), str(destination), str(ready)],
                            cwd=server, env=env, stderr=subprocess.PIPE)
    try:
        from time import monotonic, sleep
        deadline = monotonic() + 15
        while not ready.exists() and proc.poll() is None and monotonic() < deadline:
            sleep(.025)
        assert ready.exists()
        startup = _child(install, """
import asyncio
from app.main import app, lifespan
async def start():
    async with lifespan(app):
        pass
asyncio.run(start())
""", LANTERNA_DATA_HOME=str(destination))
        assert startup.returncode != 0 and "Хранилище уже занято" in startup.stderr
        with pytest.raises(BackupError, match="Хранилище уже занято"):
            restore.restore_backup(source, destination, schema)
    finally:
        if proc.poll() is None:
            proc.kill()
        proc.communicate(timeout=10)
    assert not destination.exists()
    restore.restore_backup(source, destination, schema)
    assert snapshot(source) == original


def test_hardlinked_payload_is_rejected(bundle, tmp_path):
    source, schema = bundle
    item = source / "gm_key.txt"
    peer = tmp_path / "shared key"
    os.link(item, peer)
    with pytest.raises(BackupError):
        restore.restore_backup(source, tmp_path / "destination", schema)
    assert not (tmp_path / "destination").exists()
    assert peer.read_bytes() == item.read_bytes()


def test_occupied_name_at_publication_is_preserved(bundle, tmp_path, monkeypatch):
    source, schema = bundle
    destination = tmp_path / "destination"
    publish = restore._publish

    def compete(staging, target):
        target.mkdir()
        (target / "keep").write_bytes(b"other process")
        publish(staging, target)

    monkeypatch.setattr(restore, "_publish", compete)
    with pytest.raises(BackupError):
        restore.restore_backup(source, destination, schema)
    assert snapshot(destination) == {"keep": b"other process"}


@pytest.mark.skipif(os.name != "posix", reason="Windows symlinks require elevated privileges")
def test_replaced_parent_is_not_used_for_publication_or_cleanup(bundle, tmp_path, monkeypatch):
    source, schema = bundle
    parent = tmp_path / "target parent"
    parent.mkdir()
    relocated = tmp_path / "moved parent"
    other = tmp_path / "foreign"
    other.mkdir()
    verify = restore.verify_backup

    def redirect(path, *args, **kwargs):
        result = verify(path, *args, **kwargs)
        if path != source:
            stage = path.parent.name
            # Reuse the staging basename at a foreign location.
            (other / stage).mkdir()
            (other / stage / "keep").write_bytes(b"foreign")
            parent.rename(relocated)
            parent.symlink_to(other, target_is_directory=True)
        return result

    monkeypatch.setattr(restore, "verify_backup", redirect)
    with pytest.raises(BackupError):
        restore.restore_backup(source, parent / "destination", schema)
    assert not (other / "destination").exists()
    assert next(other.glob("*/keep")).read_bytes() == b"foreign"


def test_destination_inside_backup_does_not_modify_source(bundle):
    source, schema = bundle
    before = snapshot(source)
    with pytest.raises(BackupError, match="внутри резервной копии"):
        restore.restore_backup(source, source / "destination", schema)
    assert snapshot(source) == before
