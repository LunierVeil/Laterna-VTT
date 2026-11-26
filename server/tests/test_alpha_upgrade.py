import asyncio
from contextlib import closing
from datetime import UTC, datetime
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
from types import SimpleNamespace
from uuid import UUID

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.engine import URL
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import Session

from app import alpha_upgrade as upgrade
from app import instance_restore, pre_upgrade
from app.campaign_lookup import experimental_primary_campaign_id, find_user
from app.data_home import resolve_storage
from app.db import Base
from app.instance_backup import BackupError
from app.models import AuthSession, Campaign, Character, Invite, Message, Scene, SceneFolder, Token, User, Wall
from app.schema_catalog import INITIAL_REVISION, SchemaState, inspect_schema
from app.schema_migrations import stamp_alpha_staging
from app.sessions import session_user, token_digest
from app.storage_lock import own_storage
from app.storage_preflight import StorageError, check_storage
from .test_storage_preflight import snapshot

pytestmark = pytest.mark.skipif(sys.platform != "linux", reason="Linux offline upgrade")
UpgradeBlocked = pre_upgrade.UpgradeBlocked
NOW = datetime(2035, 1, 1, tzinfo=UTC)
MEDIA_NAME = "1" * 32 + ".png"
MEDIA_URL = "/uploads/" + MEDIA_NAME


def uid(number):
    return str(UUID(int=number))


@pytest.fixture
def alpha(tmp_path):
    home = tmp_path / "old alpha"
    home.mkdir()
    paths = resolve_storage({"LANTERNA_DATA_HOME": str(home)}, server_dir=tmp_path, cwd=tmp_path)
    uploads = Path(paths.uploads)
    uploads.mkdir()
    (uploads / MEDIA_NAME).write_bytes(b"synthetic media\0fixture")
    Path(paths.gm_key).write_bytes(b"synthetic-gm-key\n")
    engine = create_engine(paths.database_url.set(drivername="sqlite"))
    Base.metadata.create_all(engine)
    with Session(engine) as db, db.begin():
        db.add(Campaign(id=uid(1), name="Alpha", active_scene_id=uid(5), created_at=NOW))
        db.add_all([
            User(id=uid(2), campaign_id=uid(1), name="GM", password_hash="fixture-gm", is_gm=True, created_at=NOW),
            User(id=uid(3), campaign_id=uid(1), name="Player", password_hash="fixture-player", is_gm=False, created_at=NOW),
            SceneFolder(id=uid(4), campaign_id=uid(1), name="Maps", created_at=NOW),
            Scene(id=uid(5), campaign_id=uid(1), folder_id=uid(4), name="Active", background_url=MEDIA_URL,
                  combat_json=json.dumps({"round": 2, "current": uid(8), "entries": [{"id": uid(8), "initiative": 18}]}),
                  fog_json=json.dumps([{"id": uid(14), "x": 19, "y": 25, "w": 50, "h": 75}]), seq=12, created_at=NOW),
            Scene(id=uid(6), campaign_id=uid(1), name="GM scene", created_at=NOW),
            Character(id=uid(7), campaign_id=uid(1), owner_id=uid(3), name="Hero", system="dnd5e",
                      data_json=json.dumps({"vitals": {"hp": {"current": 12, "max": 21}}, "resources": {"slots": 3},
                                            "portrait": MEDIA_URL}), created_at=NOW, updated_at=NOW),
            Character(id=uid(9), campaign_id=uid(1), name="NPC", system="mob",
                      data_json=json.dumps({"hp": {"current": 8, "max": 9}, "notes": "GM only"}),
                      created_at=NOW, updated_at=NOW),
            Token(id=uid(8), scene_id=uid(5), name="Linked", owner_id=uid(3), character_id=uid(7),
                  hp=12, image_url=MEDIA_URL, x=4, y=9),
            Token(id=uid(10), scene_id=uid(6), name="Secret", character_id=uid(9), layer="gm"),
            Wall(id=uid(11), scene_id=uid(5), x1=0, y1=0, x2=30, y2=10, owner_id=uid(3)),
            Wall(id=uid(12), scene_id=uid(5), x1=30, y1=10, x2=45, y2=10, kind="secret_door", door_state="locked"),
            Message(id=uid(13), campaign_id=uid(1), author_id=uid(3), author="Player", text="Roll",
                    kind="roll", roll_json=json.dumps({"dice": [17], "total": 19}), created_at=NOW),
            Message(id=uid(15), campaign_id=uid(1), author_id=uid(2), author="GM", text="Welcome", created_at=NOW),
            AuthSession(token_hash=token_digest("fixture-player-session"), user_id=uid(3), created_at=NOW),
            AuthSession(token_hash=token_digest("fixture-gm-session"), user_id=uid(2), created_at=NOW),
            Invite(token_hash=token_digest("fixture-invite"), campaign_id=uid(1), created_at=NOW, expires_at=NOW,
                   reusable=True, paused=False, token_value="fixture-invite"),
        ])
    engine.dispose()
    return paths


@pytest.fixture
def supported_mount(monkeypatch):
    monkeypatch.setattr(pre_upgrade, "_mount_id", lambda path: 1)
    monkeypatch.setattr(upgrade, "_mount_id", lambda path: 1)
    monkeypatch.setattr(upgrade.shutil, "disk_usage", lambda path: SimpleNamespace(total=10**10, free=10**10))


def files(home):
    return {str(p.relative_to(home)): p.read_bytes() for p in home.rglob("*") if p.is_file()}


def prepare(paths, destination):
    return upgrade.prepare_alpha_upgrade(paths, destination, server_dir=destination.parent,
                                         cwd=destination.parent, env={})


def read_game_state(database):
    async def read():
        url = URL.create("sqlite+aiosqlite", database=database.as_uri(), query={"uri": "true", "mode": "ro"})
        engine = create_async_engine(url)
        try:
            async with AsyncSession(engine) as db:
                campaign_id = (await db.execute(select(experimental_primary_campaign_id()))).scalar_one()
                campaign = await db.get(Campaign, campaign_id)
                player = await find_user(db, campaign, "Player")
                gm = await session_user(db, "fixture-gm-session")
                active = await session_user(db, "fixture-player-session")
                assert active.id == player.id and not active.is_gm and gm.is_gm
                assert await session_user(db, "missing") is None
                scene = await db.get(Scene, campaign.active_scene_id)
                hero = await db.get(Character, uid(7))
                npc = await db.get(Character, uid(9))
                token = await db.get(Token, uid(8))
                door = await db.get(Wall, uid(12))
                invite = await db.get(Invite, token_digest("fixture-invite"))
                roll = await db.get(Message, uid(13))
                return (
                    campaign.id, scene.id, scene.folder_id, scene.seq, scene.background_url,
                    json.loads(scene.combat_json), json.loads(scene.fog_json),
                    hero.system, json.loads(hero.data_json), npc.system, json.loads(npc.data_json),
                    token.owner_id, token.character_id, token.hp, door.kind, door.door_state,
                    invite.campaign_id, invite.reusable, (await db.get(Token, uid(10))).layer,
                    roll.author_id, json.loads(roll.roll_json),
                )
        finally:
            await engine.dispose()

    return asyncio.run(read())


def assert_fenced_alpha_copy(paths, destination, invoke=prepare):
    home = Path(paths.data_home)
    before = files(home)
    semantic_state = read_game_state(home / "lanterna.db")
    invoke(paths, destination)
    target = files(destination)
    target_marker = json.loads(target.pop(pre_upgrade.FENCE))
    with closing(sqlite3.connect(destination / "lanterna.db")) as conn:
        assert inspect_schema(conn) is SchemaState.CURRENT
        assert conn.execute("SELECT version_num FROM alembic_version").fetchall() == [(INITIAL_REVISION,)]
    assert read_game_state(destination / "lanterna.db") == semantic_state
    assert target["gm_key.txt"] == before["gm_key.txt"]
    assert target[f"uploads/{MEDIA_NAME}"] == before[f"uploads/{MEDIA_NAME}"]
    for name in target:
        assert (destination / name).stat().st_nlink == 1
        assert not os.path.samefile(destination / name, home / name)
    after = files(home)
    assert json.loads(after.pop(pre_upgrade.FENCE))["attempt_id"] == target_marker["attempt_id"]
    assert after == before
    for location in (home, destination):
        resolved = resolve_storage({"LANTERNA_DATA_HOME": str(location)}, server_dir=home.parent, cwd=home.parent)
        with own_storage(resolved), pytest.raises(UpgradeBlocked):
            pre_upgrade.assert_no_pending_upgrade(resolved)
    with pytest.raises(UpgradeBlocked):
        prepare(paths, home.parent / "another target")


def test_migration_preserves_alpha_state_and_fences_both_homes(alpha, tmp_path, supported_mount):
    assert_fenced_alpha_copy(alpha, tmp_path / "new data")


def test_real_mount_produces_fenced_target(alpha, tmp_path):
    try:
        pre_upgrade._mount_id(tmp_path)
    except UpgradeBlocked as exc:
        pytest.skip(str(exc))
    server = Path(__file__).resolve().parents[1]

    def invoke(paths, target):
        env = dict(os.environ, PYTHONPATH=str(server))
        env.pop("LANTERNA_GM_KEY", None)
        proc = subprocess.run(
            [sys.executable, "-m", "app.migration_cli", "--source", str(paths.data_home), "--destination", str(target)],
            cwd=server, env=env, capture_output=True, text=True, timeout=20,
        )
        assert proc.returncode == 0, proc.stderr
        assert "Проверенная копия" in proc.stdout and "cutover" in proc.stdout

    assert_fenced_alpha_copy(alpha, tmp_path / "new data", invoke)


def test_direct_stamp_of_alpha_source_is_rejected(alpha):
    source = Path(alpha.database_url.database)
    before = source.read_bytes()
    with create_engine(alpha.database_url.set(drivername="sqlite")).connect() as conn:
        with pytest.raises(ValueError, match="fenced private"):
            stamp_alpha_staging(conn)
    assert source.read_bytes() == before


@pytest.mark.parametrize("reason", ["occupied", "alias", "cross-tree", "space", "drift", "newer", "corrupt", "lock"])
def test_admission_errors_leave_source_unchanged(alpha, tmp_path, supported_mount, monkeypatch, reason):
    home = Path(alpha.data_home)
    target = tmp_path / "destination"
    if reason == "occupied":
        target.mkdir()
    if reason == "alias":
        alias = tmp_path / "symlink"
        alias.symlink_to(tmp_path, target_is_directory=True)
        target = alias / "other"
    if reason == "cross-tree":
        target = home / "inside"
    if reason == "space":
        monkeypatch.setattr(upgrade.shutil, "disk_usage", lambda path: SimpleNamespace(free=0))
    if reason in ("drift", "newer"):
        with closing(sqlite3.connect(home / "lanterna.db")) as conn, conn:
            if reason == "drift":
                conn.execute("CREATE INDEX unexpected ON campaigns(name)")
            else:
                conn.execute("CREATE TABLE alembic_version ( version_num VARCHAR(32) NOT NULL, "
                             "CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num) )")
                conn.execute("INSERT INTO alembic_version VALUES ('future_revision')")
    if reason == "corrupt":
        (home / "lanterna.db").write_bytes(b"not sqlite")
    before = files(home)
    if reason == "lock":
        with own_storage(alpha), pytest.raises(UpgradeBlocked):
            prepare(alpha, target)
    else:
        with pytest.raises(UpgradeBlocked):
            prepare(alpha, target)
    assert files(home) == before
    assert not list(tmp_path.glob(".laterna-pre-upgrade-*"))


@pytest.mark.parametrize("phase", ["snapshot", "copy", "stamp", "semantic"])
def test_failures_never_expose_a_partial_target(alpha, tmp_path, supported_mount, monkeypatch, phase):
    def fail(*args, **kwargs):
        raise OSError(f"injected {phase} error")

    if phase == "snapshot":
        monkeypatch.setattr(pre_upgrade, "create_backup", fail)
    elif phase == "copy":
        monkeypatch.setattr(instance_restore, "_measure", fail)
    elif phase == "stamp":
        monkeypatch.setattr(upgrade, "stamp_alpha_staging", fail)
    else:
        stamp = upgrade.stamp_alpha_staging

        def alter(connection):
            stamp(connection)
            with connection.begin():
                connection.exec_driver_sql("UPDATE tokens SET owner_id=NULL")

        monkeypatch.setattr(upgrade, "stamp_alpha_staging", alter)

    home = Path(alpha.data_home)
    before = files(home)
    target = tmp_path / "destination"
    with pytest.raises((UpgradeBlocked, BackupError, SQLAlchemyError)):
        prepare(alpha, target)
    assert not target.exists()
    after = files(home)
    assert (after.pop(pre_upgrade.FENCE, None) is None) == (phase == "snapshot")
    assert after == before


def test_uses_an_independently_supported_destination_mount(alpha, tmp_path, supported_mount, monkeypatch):
    parent = tmp_path / "other mount"
    parent.mkdir()
    monkeypatch.setattr(upgrade, "_mount_id", lambda path: 2 if path == parent or parent in path.parents else 1)
    assert_fenced_alpha_copy(alpha, parent / "new data")


def test_publication_sync_error_leaves_both_homes_fenced(alpha, tmp_path, supported_mount, monkeypatch):
    home = Path(alpha.data_home)
    target = tmp_path / "destination"
    before = files(home)
    sync = upgrade._sync_directory

    def fail_parent(path, identity):
        if path == tmp_path:
            raise OSError("injected target parent fsync failure")
        sync(path, identity)

    monkeypatch.setattr(upgrade, "_sync_directory", fail_parent)
    with pytest.raises(BackupError, match="target parent fsync failure"):
        prepare(alpha, target)
    after = files(home)
    source_marker = json.loads(after.pop(pre_upgrade.FENCE))
    assert after == before
    target_marker = json.loads((target / pre_upgrade.FENCE).read_bytes())
    assert target_marker["attempt_id"] == source_marker["attempt_id"]
    with closing(sqlite3.connect(target / "lanterna.db")) as conn:
        assert inspect_schema(conn) is SchemaState.CURRENT


def test_process_crash_before_stamp_blocks_staging_and_source(alpha, tmp_path):
    home = Path(alpha.data_home)
    target = tmp_path / "destination"
    before = files(home)
    script = """
from pathlib import Path
import os,sys
from types import SimpleNamespace
from app import alpha_upgrade as up
from app import pre_upgrade as gate
from app.data_home import resolve_storage
home, target=map(Path,sys.argv[1:])
up._mount_id = gate._mount_id = lambda path: 1
up.shutil.disk_usage = lambda path: SimpleNamespace(free=10**10)
up.stamp_alpha_staging = lambda connection: os._exit(37)
paths=resolve_storage({"LANTERNA_DATA_HOME":str(home)},server_dir=home.parent,cwd=home.parent)
up.prepare_alpha_upgrade(paths,target,server_dir=home.parent,cwd=home.parent,env={})
"""
    env = dict(os.environ, PYTHONPATH=str(Path(__file__).resolve().parents[1]))
    child = subprocess.run([sys.executable, "-c", script, str(home), str(target)], env=env,
                           capture_output=True, text=True, timeout=20)
    assert child.returncode == 37, child.stderr
    assert not target.exists()
    after = files(home)
    assert after.pop(pre_upgrade.FENCE)
    assert after == before
    [staging] = tmp_path.glob(".laterna-upgrade-staging-*/data")
    paths = resolve_storage({"LANTERNA_DATA_HOME": str(staging)}, server_dir=tmp_path, cwd=tmp_path)
    with own_storage(paths), pytest.raises(StorageError, match="промежуточный DataHome"):
        check_storage(paths, server_dir=tmp_path, cwd=tmp_path, env={}, schema={}, require_supported_catalog=True)


def test_clean_wal_offline_migration_preserves_source_inventory(alpha, tmp_path, supported_mount, monkeypatch, capsys):
    home = Path(alpha.data_home)
    database = home / "lanterna.db"
    with closing(sqlite3.connect(database)) as conn:
        assert conn.execute("PRAGMA journal_mode=WAL").fetchone() == ("wal",)
        conn.execute("UPDATE campaigns SET name='Checkpointed Alpha'")
        conn.commit()
        assert conn.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone() == (0, 0, 0)

    assert database.read_bytes()[18:20] == b"\x02\x02"
    assert {path.name for path in home.iterdir()} == {"lanterna.db", "uploads", "gm_key.txt"}
    before = snapshot(home)
    target = tmp_path / "destination"
    monkeypatch.delenv("LANTERNA_GM_KEY", raising=False)
    monkeypatch.setattr(sys, "argv", ["migration_cli", "--source", str(home), "--destination", str(target)])
    from app.migration_cli import main

    assert main() == 1
    assert snapshot(home) == before
    assert not target.exists()
    assert not list(tmp_path.glob(".laterna-pre-upgrade-*"))
    assert "WAL не допускается" in capsys.readouterr().err


def test_busy_destination_rejected_before_source_fence(alpha, tmp_path, supported_mount):
    home = Path(alpha.data_home)
    before = files(home)
    target = tmp_path / "destination"
    target_paths = resolve_storage({"LANTERNA_DATA_HOME": str(target)}, server_dir=tmp_path, cwd=tmp_path)

    with own_storage(target_paths), pytest.raises((StorageError, BackupError), match="занято"):
        prepare(alpha, target)

    assert files(home) == before
    assert not target.exists()
    assert not list(tmp_path.glob(".laterna-pre-upgrade-*"))


def test_destination_occupied_after_source_fence_is_preserved(alpha, tmp_path, supported_mount, monkeypatch):
    home = Path(alpha.data_home)
    before = files(home)
    target = tmp_path / "destination"
    publish = instance_restore._publish

    def occupy(staging, destination):
        assert destination == target
        assert (home / pre_upgrade.FENCE).is_file()
        target.mkdir()
        (target / "sentinel").write_bytes(b"competitor")
        publish(staging, destination)

    monkeypatch.setattr(instance_restore, "_publish", occupy)
    with pytest.raises(BackupError):
        prepare(alpha, target)
    after = files(home)
    assert pre_upgrade.FENCE in after
    del after[pre_upgrade.FENCE]
    assert after == before
    assert files(target) == {"sentinel": b"competitor"}
