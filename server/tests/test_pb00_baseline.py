"""PB-00 characterization: Alpha behavior, not future LOS/security acceptance."""
import json
import os
import base64
import subprocess
import sys
from uuid import uuid4
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.geometry import path_blocked
from .fixtures.los_baseline import scenes, seed_database
# Reuse established single-event-loop TestClient/auth helpers; no second server.
from .test_handlers import client, gm, scene_id, session_headers, recv_until, run  # noqa: F401


@pytest.fixture(scope="module")
def player(client, gm, scene_id):
    # The existing handler module also creates a player in this temporary
    # campaign. Reusing its fixed name at module scope collided in a full run.
    with client.websocket_connect(f"/ws/scene/{scene_id}", headers=gm) as ws:
        ws.receive_json()
        token = run(ws, "pb00-invite", "invite.create", {})["payload"]["token"]
        recv_until(ws, lambda m: m.get("type") == "campaign")
    response = client.post("/api/invite/accept", json={
        "token": token, "name": f"PB00-{uuid4().hex}", "password": "pb00-synthetic-password"})
    headers = session_headers(client, response)
    return {"headers": headers, "id": response.json()["id"]}


def test_pytest_temporary_database_uploads_and_key_are_removed_on_exit():
    code = """
from tests.conftest import _TMP
(_TMP / 'test.db').write_bytes(b'synthetic database')
(_TMP / 'uploads').mkdir()
(_TMP / 'uploads' / 'synthetic.txt').write_text('fixture')
(_TMP / 'gm_key.txt').write_text('synthetic test key')
print(_TMP)
"""
    path = Path(subprocess.check_output([sys.executable, "-c", code], cwd=Path(__file__).resolve().parents[1], text=True).strip())
    assert path.name.startswith("laterna-tests-")
    assert not path.exists()


@pytest.mark.parametrize("name", scenes())
def test_scene_generation_is_reproducible_and_independent(name):
    first = scenes()[name]
    assert json.dumps(first, sort_keys=True, allow_nan=False) == json.dumps(scenes()[name], sort_keys=True, allow_nan=False)
    first["tokens"].clear()
    if name != "empty":
        assert scenes()[name]["tokens"]


def test_complex_profile_and_movement_characterization():
    profile = scenes()["complex"]
    assert len(profile["tokens"]) == 30
    assert len(profile["walls"]) == 200
    assert sum(t["emits_light"] > 0 for t in profile["tokens"]) == 15
    for name, blocked in (("straight", True), ("door-closed", True), ("door-open", False), ("door-locked", True)):
        assert path_blocked(105, 105, 805, 105, [SimpleNamespace(**w) for w in scenes()[name]["walls"]]) is blocked
    window = scenes()["window-opening"]["walls"][0]
    assert window["kind"] == "window" and not window["blocks_sight"]
    # Merely test-data flags: no assertion that an Alpha LOS engine exists.


@pytest.fixture
def seeded(client, gm, player, scene_id):
    created = []
    def create(name):
        with client.websocket_connect(f"/ws/scene/{scene_id}", headers=gm) as ws:
            ws.receive_json()
            sid = run(ws, "pb00-create", "scene.create", {"name": f"PB00 {name}"})["payload"]["id"]
            created.append(sid)
            recv_until(ws, lambda m: m.get("type") == "campaign")
        gm_id = client.get("/api/me", headers=gm).json()["id"]
        database = Path(os.environ["DATABASE_URL"].removeprefix("sqlite+aiosqlite:///"))
        seed = seed_database(database, sid, gm_id, player["id"], name)
        return sid, seed
    try:
        yield create
    finally:
        with client.websocket_connect(f"/ws/scene/{scene_id}", headers=gm) as ws:
            ws.receive_json()
            for sid in created:
                run(ws, f"pb00-cleanup-{sid}", "scene.delete", {"id": sid})
                recv_until(ws, lambda m: m.get("type") == "campaign")
                assert client.get(f"/api/scenes/{sid}", headers=gm).json() == {"error": "scene not found"}
                assert sid not in {s["id"] for s in client.get("/api/scenes", headers=gm).json()}


@pytest.mark.parametrize("name", scenes())
def test_alpha_models_roundtrip_all_fixture_fields(client, gm, seeded, name):
    sid, seed = seeded(name)
    response = client.get(f"/api/scenes/{sid}", headers=gm)
    assert response.status_code == 200
    snapshot = response.json()
    assert snapshot["seq"] == 0 and snapshot["fog"] == seed["data"]["fog"]
    for field in ("name", "width", "height", "grid_size", "grid_type", "background_url", "combat"):
        assert snapshot[field] == seed["data"][field]
    for collection in ("tokens", "walls"):
        actual = {obj["id"]: obj for obj in snapshot[collection]}
        assert set(actual) == set(seed["ids"][collection])
        for index, source in enumerate(seed["data"][collection]):
            for field, value in source.items():
                if field != "owner":
                    assert actual[seed["ids"][collection][index]][field] == value


def test_seeder_refuses_arbitrary_paths_and_overwrite(tmp_path, client, gm, player, seeded):
    outside = tmp_path / "test.db"
    outside.write_bytes(b"not a user database")
    with pytest.raises(ValueError, match="temporary"):
        seed_database(outside, "unused", "unused", "unused", "empty")
    assert outside.read_bytes() == b"not a user database"
    sid, _ = seeded("straight")
    database = Path(os.environ["DATABASE_URL"].removeprefix("sqlite+aiosqlite:///"))
    with pytest.raises(ValueError, match="overwrites"):
        seed_database(database, sid, client.get("/api/me", headers=gm).json()["id"], player["id"], "empty")


def test_two_clients_snapshot_noop_sequence_and_reconnect(client, gm, player, scene_id, seeded):
    sid, seed = seeded("manual-fog")
    # Activate via existing campaign command, not a new transport.
    with client.websocket_connect(f"/ws/scene/{scene_id}", headers=gm) as controller:
        controller.receive_json()
        run(controller, "pb00-activate", "scene.activate", {"id": sid})
        recv_until(controller, lambda m: m.get("type") == "campaign")
    own, hidden, secret = seed["ids"]["tokens"]
    try:
        with client.websocket_connect(f"/ws/scene/{sid}", headers=gm) as g:
            master = g.receive_json()
            with client.websocket_connect(f"/ws/scene/{sid}", headers=player["headers"]) as p:
                initial = p.receive_json()
                assert master["type"] == initial["type"] == "snapshot"
                assert {t["id"] for t in master["scene"]["tokens"]} == {own, hidden, secret}
                assert {t["id"] for t in initial["scene"]["tokens"]} == {own}, "own token survives manual fog"
                assert {w["id"] for w in master["scene"]["walls"]} == set(seed["ids"]["walls"])
                assert initial["scene"]["walls"] == [], "fully fogged occluder is not sent to player"
                event = run(g, "pb00-private", "token.update", {"id": secret, "name": "PB00 private changed"})
                noop = recv_until(p, lambda m: m.get("type") == "event")
                assert event["cmd_id"] == "pb00-private" and event["seq"] == initial["seq"] + 1
                assert noop == dict(type="event", seq=event["seq"], name="noop", payload={}, cmd_id=None)
                moved = run(p, "pb00-move", "token.move", {"id": own, "x": 875, "y": 175})
                delivered = recv_until(g, lambda m: m.get("cmd_id") == "pb00-move")
                assert moved == delivered and moved["seq"] == event["seq"] + 1
            # Player disconnected: a subsequent authoritative change is recovered
            # by snapshot, not replay/duplicate command execution.
            latest = run(g, "pb00-offline", "token.move", {"id": own, "x": 945, "y": 175})
            with client.websocket_connect(f"/ws/scene/{sid}", headers=player["headers"]) as reconnected:
                snap = reconnected.receive_json()
                assert snap["type"] == "snapshot" and snap["seq"] == latest["seq"]
                assert {t["id"] for t in snap["scene"]["tokens"]} == {own}
                assert snap["scene"]["tokens"][0]["x"] == 945
                assert snap["scene"]["walls"] == []
    finally:
        with client.websocket_connect(f"/ws/scene/{sid}", headers=gm) as ws:
            ws.receive_json()
            run(ws, "pb00-return", "scene.activate", {"id": scene_id})
            recv_until(ws, lambda m: m.get("type") == "campaign")


def test_gap_private_image_url_is_currently_public(client, gm, seeded):
    """GAP reproduction, NOT a security guarantee: PB-02 must close this path."""
    png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=")
    response = client.post("/api/uploads", headers={**gm, "Content-Type": "image/png"}, content=png)
    assert response.status_code == 200
    sid, seed = seeded("gm-layer")
    with client.websocket_connect(f"/ws/scene/{sid}", headers=gm) as ws:
        ws.receive_json()
        linked = run(ws, "pb00-private-image", "token.update", {
            "id": seed["ids"]["tokens"][1], "image_url": response.json()["url"]})
        assert linked["payload"]["token"]["layer"] == "gm"
    # Anonymous request with a copied URL; no real/private media is used.
    public = client.get(response.json()["url"])
    assert public.status_code == 200 and public.content == png
