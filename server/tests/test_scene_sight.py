"""Real DB/WS command integration, using only conftest-owned temporary data."""
from uuid import uuid4

import pytest
from sqlalchemy import event, select

from app import main
from app.db import SessionLocal, engine
from app.line_of_sight import SightState
from app.models import Scene, Wall
from app.scene_sight import (SceneGeometryUnavailable, prepare_scene_geometry,
                             scene_sight, scene_sights)
from .test_handlers import client, gm, scene_id, recv_until, run  # noqa: F401

A, B = (100., 100.), (600., 100.)


@pytest.fixture
def test_scene(client, gm, scene_id):
    with client.websocket_connect(f"/ws/scene/{scene_id}", headers=gm) as ws:
        ws.receive_json()
        sid = run(ws, "los-create", "scene.create", {"name": "PB01c synthetic"})["payload"]["id"]
        recv_until(ws, lambda m: m.get("type") == "campaign")
    yield sid
    with client.websocket_connect(f"/ws/scene/{scene_id}", headers=gm) as ws:
        ws.receive_json()
        reply = run(ws, "los-delete", "scene.delete", {"id": sid})
        assert reply["type"] == "reply"
        recv_until(ws, lambda m: m.get("type") == "campaign")


def query(client, sid, a=A, b=B):
    return client.portal.call(scene_sight, sid, a, b)


def add(ws, kind="wall", blocks_sight=True):
    reply = run(ws, uuid4().hex, "wall.add", {
        "x1": 350., "y1": 0., "x2": 350., "y2": 350.,
        "kind": kind, "blocks_sight": blocks_sight})
    assert reply["name"] == "wall.added"
    return reply["payload"]["wall"]["id"]


def test_real_empty_add_remove_and_scene_resize(client, gm, test_scene):
    sid = test_scene
    assert query(client, sid).state is SightState.CLEAR
    with client.websocket_connect(f"/ws/scene/{sid}", headers=gm) as ws:
        ws.receive_json()
        wid = add(ws)
        assert query(client, sid).state is SightState.BLOCKED
        assert query(client, sid, A, (300., 100.)).state is SightState.CLEAR
        assert query(client, sid, (350., 100.), B).state is SightState.OBSERVER_ON_OBSTACLE
        assert run(ws, "resize", "scene.update", {"width": 700, "height": 400})["name"] == "scene.updated"
        assert query(client, sid).state is SightState.BLOCKED
        with pytest.raises(ValueError):
            query(client, sid, A, (701., 100.))
        assert run(ws, "remove", "wall.remove", {"id": wid})["name"] == "wall.removed"
        assert query(client, sid).state is SightState.CLEAR


@pytest.mark.parametrize("flag", [False, True])
def test_door_commits_override_flag_and_next_query_sees_every_state(client, gm, test_scene, flag):
    with client.websocket_connect(f"/ws/scene/{test_scene}", headers=gm) as ws:
        ws.receive_json()
        wid = add(ws, "door", flag)
        for state in ("open", "closed", "open", "locked", "closed", "open"):
            event = run(ws, uuid4().hex, "wall.door", {"id": wid, "state": state})
            assert event["name"] == "wall.updated"
            expected = SightState.CLEAR if state == "open" else SightState.BLOCKED
            assert query(client, test_scene).state is expected


def test_transparent_ordinary_wall(client, gm, test_scene):
    with client.websocket_connect(f"/ws/scene/{test_scene}", headers=gm) as ws:
        ws.receive_json()
        add(ws, blocks_sight=False)
        assert query(client, test_scene).state is SightState.CLEAR


def test_old_prepared_snapshot_cannot_poison_fresh_server_query(client, gm, test_scene):
    async def old_snapshot():
        async with SessionLocal() as db:
            scene = await db.get(Scene, test_scene)
            walls = (await db.scalars(select(Wall).where(Wall.scene_id == test_scene))).all()
            return prepare_scene_geometry(scene, walls)
    old = client.portal.call(old_snapshot)
    assert old.point_sight(A, B).state is SightState.CLEAR
    with client.websocket_connect(f"/ws/scene/{test_scene}", headers=gm) as ws:
        ws.receive_json()
        add(ws)
        # Pure snapshots remain point-in-time values, never a live cache.
        assert old.point_sight(A, B).state is SightState.CLEAR
        assert query(client, test_scene).state is SightState.BLOCKED


def test_batch_one_select_and_isolated_scene_switches(client, gm, test_scene):
    with client.websocket_connect(f"/ws/scene/{test_scene}", headers=gm) as ws:
        ws.receive_json()
        add(ws)
    statements = []
    def record(conn, cursor, statement, parameters, context, executemany):
        if statement.lstrip().upper().startswith("SELECT"):
            statements.append(statement)
    event.listen(engine.sync_engine, "before_cursor_execute", record)
    try:
        results = client.portal.call(scene_sights, test_scene, [(A, B)] * 100)
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", record)
    assert len(results) == 100 and all(r.state is SightState.BLOCKED for r in results)
    assert len(statements) == 1 and "LEFT OUTER JOIN walls" in statements[0]
    assert "fog_json" not in statements[0] and "background_url" not in statements[0]
    assert query(client, test_scene).state is SightState.BLOCKED


def test_failed_command_rollback_has_no_cache_invalidation(client, gm, test_scene, monkeypatch):
    original = main.HANDLERS["wall.add"]
    async def fail_after_flush(db, scene, actor, payload):
        await original(db, scene, actor, payload)
        raise RuntimeError("synthetic failure after wall flush")
    with client.websocket_connect(f"/ws/scene/{test_scene}", headers=gm) as ws:
        ws.receive_json()
        monkeypatch.setitem(main.HANDLERS, "wall.add", fail_after_flush)
        failure = run(ws, "rollback-add", "wall.add", {
            "x1": 350, "y1": 0, "x2": 350, "y2": 350})
        assert failure["type"] == "error"
        assert query(client, test_scene).state is SightState.CLEAR
        monkeypatch.setitem(main.HANDLERS, "wall.add", original)
        add(ws)
        assert query(client, test_scene).state is SightState.BLOCKED


@pytest.mark.parametrize("kind,state", [("window", "closed"), ("secret_door", "closed"),
                                       ("invisible", "closed"), ("unknown", "open"),
                                       ("door", "unknown")])
def test_unknown_saved_geometry_is_explicit_error_not_transparency(client, test_scene, kind, state):
    async def insert():
        async with SessionLocal() as db:
            db.add(Wall(scene_id=test_scene, x1=350, y1=0, x2=350, y2=350,
                        kind=kind, door_state=state, blocks_sight=False))
            await db.commit()
    client.portal.call(insert)
    with pytest.raises(SceneGeometryUnavailable):
        query(client, test_scene)


def test_old_supported_scene_zero_and_tiny_segments_no_schema_change(client, test_scene):
    async def insert():
        async with SessionLocal() as db:
            db.add_all([
                Wall(scene_id=test_scene, x1=200, y1=100, x2=200, y2=100),
                Wall(scene_id=test_scene, x1=350, y1=100, x2=350, y2=100 + 5e-8)])
            await db.commit()
    client.portal.call(insert)
    result = query(client, test_scene)
    assert result.state is SightState.BLOCKED and result.ignored_zero_length == 1


def test_missing_or_deleted_scene_does_not_return_clear(client, gm, scene_id):
    sid = uuid4().hex
    with pytest.raises(SceneGeometryUnavailable):
        query(client, sid)
    with client.websocket_connect(f"/ws/scene/{scene_id}", headers=gm) as ws:
        ws.receive_json()
        sid = run(ws, "temporary-create", "scene.create", {"name": "PB01c delete"})["payload"]["id"]
        recv_until(ws, lambda m: m.get("type") == "campaign")
        assert query(client, sid).state is SightState.CLEAR
        assert run(ws, "temporary-delete", "scene.delete", {"id": sid})["type"] == "reply"
        recv_until(ws, lambda m: m.get("type") == "campaign")
    with pytest.raises(SceneGeometryUnavailable):
        query(client, sid)


def test_scene_activation_does_not_mix_geometry(client, gm, test_scene, scene_id):
    with client.websocket_connect(f"/ws/scene/{test_scene}", headers=gm) as ws:
        ws.receive_json()
        add(ws)
    with client.websocket_connect(f"/ws/scene/{scene_id}", headers=gm) as ws:
        ws.receive_json()
        other = run(ws, "second-create", "scene.create", {"name": "PB01c other"})["payload"]["id"]
        recv_until(ws, lambda m: m.get("type") == "campaign")
        try:
            for active in (other, test_scene, other):
                assert run(ws, uuid4().hex, "scene.activate", {"id": active})["type"] == "reply"
                recv_until(ws, lambda m: m.get("type") == "campaign")
                assert query(client, other).state is SightState.CLEAR
                assert query(client, test_scene).state is SightState.BLOCKED
        finally:
            run(ws, "restore-active", "scene.activate", {"id": scene_id})
            recv_until(ws, lambda m: m.get("type") == "campaign")
            run(ws, "second-remove", "scene.delete", {"id": other})
            recv_until(ws, lambda m: m.get("type") == "campaign")


def test_uncommitted_door_rollback_and_independent_connection(client, gm, test_scene):
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    from app.config import DATABASE_URL
    with client.websocket_connect(f"/ws/scene/{test_scene}", headers=gm) as ws:
        ws.receive_json()
        wid = add(ws, "door")
        run(ws, "open-before-transaction", "wall.door", {"id": wid, "state": "open"})
    async def transactions():
        # Independent engine models another application instance sharing the DB.
        other_engine = create_async_engine(DATABASE_URL)
        sessions = async_sessionmaker(other_engine, expire_on_commit=False)
        try:
            async with sessions() as db:
                door = await db.get(Wall, wid)
                door.door_state = "closed"
                await db.flush()
                assert (await scene_sight(test_scene, A, B)).state is SightState.CLEAR
                await db.rollback()
            assert (await scene_sight(test_scene, A, B)).state is SightState.CLEAR
            async with sessions() as db:
                door = await db.get(Wall, wid)
                door.door_state = "closed"
                await db.commit()
            assert (await scene_sight(test_scene, A, B)).state is SightState.BLOCKED
        finally:
            await other_engine.dispose()
    client.portal.call(transactions)


def test_resize_past_old_wall_fails_without_rewriting_saved_data(client, gm, test_scene):
    with client.websocket_connect(f"/ws/scene/{test_scene}", headers=gm) as ws:
        ws.receive_json()
        wid = add(ws)
        run(ws, "shrink", "scene.update", {"width": 200})
        with pytest.raises(ValueError):
            query(client, test_scene, (10., 10.), (100., 10.))
        async def persisted():
            async with SessionLocal() as db:
                return (await db.get(Wall, wid)).x1
        assert client.portal.call(persisted) == 350.
        run(ws, "expand", "scene.update", {"width": 700})
        assert query(client, test_scene).state is SightState.BLOCKED


def test_adapter_copies_orm_values_and_rejects_cross_scene_or_ambiguous_flags():
    scene = Scene(id="synthetic-scene", width=2100, height=1400)
    door = Wall(scene_id=scene.id, x1=350, y1=0, x2=350, y2=350,
                kind="door", door_state="open", blocks_sight=True)
    old = prepare_scene_geometry(scene, [door])
    door.door_state = "closed"
    assert old.point_sight(A, B).state is SightState.CLEAR
    assert prepare_scene_geometry(scene, [door]).point_sight(A, B).state is SightState.BLOCKED
    door.scene_id = "another-scene"
    with pytest.raises(SceneGeometryUnavailable):
        prepare_scene_geometry(scene, [door])
    door.scene_id, door.kind, door.blocks_sight = scene.id, "wall", None
    with pytest.raises(SceneGeometryUnavailable):
        prepare_scene_geometry(scene, [door])
