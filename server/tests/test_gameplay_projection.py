"""Opt-in exact LOS through real REST, WS and protected media; owned fixtures only."""
import json
from types import SimpleNamespace

import anyio
import pytest
from sqlalchemy import select, delete

from app import config, main
from app.db import SessionLocal
from app.models import Scene, Token, Wall
from .test_handlers import client, gm, run, recv_until  # noqa: F401
from .test_pb02_projection import world  # noqa: F401


@pytest.fixture
def room(client, world, monkeypatch):
    monkeypatch.setattr(config, 'EXPERIMENTAL_VISIBILITY', True)

    async def seed():
        async with SessionLocal() as db:
            scene = await db.get(Scene, world.scene)
            before = (scene.fog_json, scene.combat_json)
            scene.fog_json = '[]'
            own = await db.get(Token, world.own)
            npc = await db.get(Token, world.obscured)
            second = (await db.scalars(select(Token).where(Token.scene_id == world.scene,
                            Token.owner_id == world.users[1]))).one()
            original = [(t.id, t.x, t.y, t.character_id) for t in (own, npc, second)]
            own.x, own.y = 100, 200
            second.x, second.y = 400, 400
            npc.x, npc.y, npc.character_id = 400, 200, world.character
            door = Wall(scene_id=world.scene, x1=250, y1=100, x2=250, y2=300, kind='door')
            db.add_all([door, Wall(scene_id=world.scene,x1=250,y1=0,x2=250,y2=100),
                       Wall(scene_id=world.scene,x1=250,y1=300,x2=250,y2=scene.height)])
            await db.commit()
            return door.id, original, before
    door, original, before = client.portal.call(seed)
    yield SimpleNamespace(**vars(world), door=door)

    async def restore():
        async with SessionLocal() as db:
            await db.execute(delete(Wall).where(Wall.scene_id == world.scene))
            scene = await db.get(Scene, world.scene)
            scene.fog_json, scene.combat_json = before
            for tid, x, y, cid in original:
                token = await db.get(Token, tid)
                token.x, token.y, token.character_id = x, y, cid
            await db.commit()
    client.portal.call(restore)


def ids(snapshot):
    return {t['id'] for t in snapshot['tokens']}


def rest(client, room, who=0):
    response = client.get(f'/api/scenes/{room.scene}', headers=room.headers[who])
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.parametrize('state', ['closed', 'locked'])
def test_personal_rest_initial_resync_and_private_media(client, gm, room, state):
    with client.websocket_connect(f'/ws/scene/{room.scene}', headers=gm) as master:
        recv_until(master, lambda m: m['type'] == 'snapshot')
        assert run(master, 'state', 'wall.door', {'id': room.door, 'state': state})['type'] == 'event'
    assert room.obscured in ids(client.get(f'/api/scenes/{room.scene}', headers=gm).json())
    assert room.obscured not in ids(rest(client, room))
    assert room.obscured in ids(rest(client, room, 1)), 'personal, not union/shared vision'
    assert client.get(room.files['fog'], headers=room.headers[0]).status_code == 404
    assert client.get(room.files['portrait'], headers=room.headers[0]).status_code == 404
    assert client.get(room.files['portrait'], headers=room.headers[1]).status_code == 200
    assert client.get(room.files['private'], headers=room.headers[1]).status_code == 404
    for _ in range(2):  # SceneSocket resync uses reconnection, not a resync command.
        with client.websocket_connect(f'/ws/scene/{room.scene}', headers=room.headers[0]) as player:
            snap = recv_until(player, lambda m: m['type'] == 'snapshot')
            assert room.obscured not in ids(snap['scene'])


def test_open_close_reveals_revokes_same_seq_and_mutations_fail_closed(client, gm, room):
    with client.websocket_connect(f'/ws/scene/{room.scene}', headers=gm) as master, \
         client.websocket_connect(f'/ws/scene/{room.scene}', headers=room.headers[0]) as player:
        recv_until(master, lambda m: m['type'] == 'snapshot')
        assert room.obscured not in ids(recv_until(player, lambda m: m['type'] == 'snapshot')['scene'])
        before = rest(client, room)['seq']
        denied = run(player, 'guess', 'combat.add', {'token_id': room.obscured})
        assert denied['type'] == 'error'
        assert rest(client, room)['seq'] == before, 'denial rolls back, no seq increment'
        for state, expected in [('open', True), ('closed', False), ('open', True), ('locked', False)]:
            ack = run(master, state, 'wall.door', {'id': room.door, 'state': state})
            assert ack['type'] == 'event'
            event = recv_until(player, lambda m: m.get('seq') == ack['seq'] and m['type'] == 'event')
            assert event['cmd_id'] == state
            snap = recv_until(player, lambda m: m['type'] == 'snapshot' and m['seq'] == ack['seq'])
            assert (room.obscured in ids(snap['scene'])) is expected
            assert (room.obscured in ids(rest(client, room))) is expected
            assert client.get(room.files['portrait'], headers=room.headers[0]).status_code == (200 if expected else 404)


def test_combat_and_hidden_updates_are_personalized(client, gm, room):
    with client.websocket_connect(f'/ws/scene/{room.scene}', headers=gm) as master, \
         client.websocket_connect(f'/ws/scene/{room.scene}', headers=room.headers[0]) as player:
        recv_until(master, lambda m: m['type'] == 'snapshot')
        recv_until(player, lambda m: m['type'] == 'snapshot')
        added = run(master, 'combat', 'combat.add', {'token_id': room.obscured})
        event = recv_until(player, lambda m: m.get('seq') == added['seq'] and m['type'] == 'event')
        assert room.obscured not in json.dumps(event)
        assert room.obscured not in json.dumps(rest(client, room)['combat'])
        update = run(master, 'hidden-update', 'token.update', {'id': room.obscured, 'name': 'LOS SECRET'})
        event = recv_until(player, lambda m: m.get('seq') == update['seq'] and m['type'] == 'event')
        assert event['name'] == 'noop'
        assert 'LOS SECRET' not in json.dumps(event)


def test_late_calculation_cannot_restore_open_door_projection(client, room, monkeypatch):
    async def check():
        async with SessionLocal() as db:
            (await db.get(Wall, room.door)).door_state = 'open'
            await db.commit()
        from app import auth
        from app.recipient_projection import recipient
        async with SessionLocal() as db:
            subject = await recipient(db, auth.session_id(room.sessions[0]), scene_id=room.scene)
        entered, release = anyio.Event(), anyio.Event()
        original = main.calculate_bounded
        calls = 0
        async def held(*args):
            nonlocal calls
            result = await original(*args)
            calls += 1
            if calls == 1:
                assert room.obscured in result.ids
                entered.set()
                await release.wait()
            return result
        monkeypatch.setattr(main, 'calculate_bounded', held)
        result = []
        async def request():
            async with SessionLocal() as db:
                result.append(await main.scene_snapshot(db, room.scene, subject[0]))
        async with anyio.create_task_group() as tasks:
            tasks.start_soon(request)
            await entered.wait()
            async with SessionLocal() as db:
                # Deliberately no seq change: correctness must not rely on seq alone.
                (await db.get(Wall, room.door)).door_state = 'closed'
                await db.commit()
            release.set()
        assert calls == 2
        assert room.obscured not in ids(result[0])
    client.portal.call(check)


def test_initial_publication_rechecks_geometry_after_preparation(client, room, monkeypatch):
    async def door(state):
        async with SessionLocal() as db:
            (await db.get(Wall, room.door)).door_state = state
            await db.commit()
    client.portal.call(door, 'open')
    entered, release = client.portal.call(anyio.Event), client.portal.call(anyio.Event)
    original = main.send_initial
    prepared = []
    async def held(ws, sid, actor, message, **kwargs):
        if actor.id == room.users[0] and message['type'] == 'snapshot':
            assert room.obscured in ids(message['scene'])
            prepared.append(message)
            entered.set()
            await release.wait()
        return await original(ws, sid, actor, message, **kwargs)
    monkeypatch.setattr(main, 'send_initial', held)
    with client.websocket_connect(f'/ws/scene/{room.scene}', headers=room.headers[0]) as player:
        async def barrier():
            with anyio.fail_after(5):
                await entered.wait()
        try:
            client.portal.call(barrier)
            client.portal.call(door, 'closed')
        finally:
            client.portal.call(release.set)
        message = player.receive_json()
        assert message['type'] == 'campaign', 'fresh navigation control, never stale private snapshot'
        assert room.obscured not in json.dumps(message)
        assert len(prepared) == 1


def test_preview_origin_destination_and_door_revocation(client, gm, room):
    from uuid import uuid4
    with client.websocket_connect(f'/ws/scene/{room.scene}', headers=gm) as master, \
         client.websocket_connect(f'/ws/scene/{room.scene}', headers=room.headers[0]) as player:
        recv_until(master, lambda m: m['type'] == 'snapshot')
        recv_until(player, lambda m: m['type'] == 'snapshot')
        def preview(x, y, base_seq):
            master.send_json({'id': str(uuid4()), 'name': 'token.preview', 'payload': {
                'id': room.obscured, 'drag_id': str(uuid4()), 'step': 1, 'base_seq': base_seq, 'x': x, 'y': y}})
        def barrier(label):
            ack = run(master, label, 'token.update', {'id': room.own, 'name': label})
            messages = []
            recv_until(player, lambda m: messages.append(m) or (m.get('seq') == ack['seq'] and m['type'] == 'event'))
            return messages
        preview(450, 200, rest(client, room)['seq'])
        assert not any(m['type'] == 'token_preview' for m in barrier('hidden-preview'))
        opened = run(master, 'open-preview', 'wall.door', {'id': room.door, 'state': 'open'})
        recv_until(player, lambda m: m['type'] == 'snapshot' and m['seq'] == opened['seq'])
        # Reset only test rate-limit bookkeeping; no arbitrary timing sleeps.
        client.portal.call(main.previews.last.clear)
        preview(450, 200, opened['seq'])
        messages = barrier('visible-preview')
        assert any(m['type'] == 'token_preview' and not m['end'] for m in messages)
        closed = run(master, 'close-preview', 'wall.door', {'id': room.door, 'state': 'closed'})
        messages = []
        recv_until(player, lambda m: messages.append(m) or (m['type'] == 'snapshot' and m['seq'] == closed['seq']))
        assert any(m['type'] == 'token_preview' and m['end'] for m in messages)
        opened = run(master, 'reopen-preview', 'wall.door', {'id': room.door, 'state': 'open'})
        recv_until(player, lambda m: m['type'] == 'snapshot' and m['seq'] == opened['seq'])
        client.portal.call(main.previews.last.clear)
        preview(400, 400, opened['seq'])  # visible origin, destination behind the lower wall
        assert not any(m['type'] == 'token_preview' and not m['end'] for m in barrier('blocked-destination'))
