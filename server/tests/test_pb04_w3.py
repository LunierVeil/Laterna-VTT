"""W3: real commands, exact LOS, movement and recipient/media boundaries."""
import json
from types import SimpleNamespace
from uuid import uuid4

import anyio
import pytest

from app import main
from app.db import SessionLocal
from app.geometry import path_blocked
from app.line_of_sight import SightState
from app.models import Wall
from app.scene_sight import SceneGeometryUnavailable, prepare_scene_geometry, scene_sight
from .test_handlers import client, gm, run, recv_until  # noqa: F401
from .test_pb02_projection import world  # noqa: F401
from .test_gameplay_projection import room, rest, ids  # noqa: F401
from .test_scene_sight import test_scene, scene_id  # noqa: F401


def command(ws, name, payload):
    return run(ws, uuid4().hex, name, payload)


def wall_payload(**fields):
    return dict(x1=350., y1=0., x2=350., y2=350., kind='window', **fields)


@pytest.mark.parametrize('sight', [False, True])
@pytest.mark.parametrize('movement', [False, True])
def test_independent_window_flags_survive_commands_and_reconnect(client, gm, test_scene, sight, movement):
    with client.websocket_connect(f'/ws/scene/{test_scene}', headers=gm) as ws:
        recv_until(ws, lambda m: m['type'] == 'snapshot')
        added = command(ws, 'wall.add', wall_payload(blocks_sight=sight, blocks_movement=movement))
        wall = added['payload']['wall']
        assert (wall['blocks_sight'], wall['blocks_movement']) == (sight, movement)
        assert client.portal.call(scene_sight, test_scene, (100.,100.), (600.,100.)).state is (
            SightState.BLOCKED if sight else SightState.CLEAR)
        token = command(ws, 'token.add', {'x':100,'y':100})['payload']['token']
        moved = command(ws, 'token.move', {'id':token['id'],'x':600,'y':100})
        assert moved['type'] == ('error' if movement else 'event')
    with client.websocket_connect(f'/ws/scene/{test_scene}', headers=gm) as ws:
        saved = recv_until(ws, lambda m: m['type'] == 'snapshot')['scene']['walls']
        assert next(w for w in saved if w['id'] == wall['id']) == wall


def test_glass_defaults_and_atomic_property_updates(client, gm, test_scene):
    with client.websocket_connect(f'/ws/scene/{test_scene}', headers=gm) as ws:
        recv_until(ws, lambda m: m['type'] == 'snapshot')
        glass = command(ws, 'wall.add', wall_payload())['payload']['wall']
        assert glass['blocks_sight'] is False and glass['blocks_movement'] is True
        for changes in ({'blocks_sight':True}, {'blocks_sight':False,'blocks_movement':False},
                        {'kind':'door','door_state':'locked'}, {'door_state':'open'},
                        {'kind':'window','x1':420,'x2':420}):
            event = command(ws, 'wall.update', {'id':glass['id'], **changes})
            assert event['name'] == 'wall.updated'
            current = event['payload']['wall']
            assert all(current[k] == v for k,v in changes.items())
            assert current['id'] == glass['id'] and current['owner_id'] == glass['owner_id']
            glass = current
        before = client.get(f'/api/scenes/{test_scene}', headers=gm).json()
        for changes in ({'x1':float('nan')}, {'x1':420,'y1':350}, {'blocks_sight':'false'},
                        {'blocks_movement':None}, {'kind':'secret_door'}, {'door_state':'invalid'}):
            assert command(ws, 'wall.update', {'id':glass['id'], **changes})['type'] == 'error'
            assert client.get(f'/api/scenes/{test_scene}', headers=gm).json() == before
        assert command(ws,'wall.update',{'id':uuid4().hex,'blocks_sight':True})['type']=='error'
        # Existing walls keep the legacy default, not the glass default.
        ordinary = command(ws,'wall.add',{'x1':100,'y1':0,'x2':100,'y2':200})['payload']['wall']
        assert ordinary['kind']=='wall' and ordinary['blocks_sight'] and ordinary['blocks_movement']


@pytest.mark.parametrize('flag', ['blocks_sight','blocks_movement'])
@pytest.mark.parametrize('bad', [None, 0, 1, 'false', [], {}])
def test_new_wall_flags_require_actual_booleans(client, gm, test_scene, flag, bad):
    with client.websocket_connect(f'/ws/scene/{test_scene}',headers=gm) as ws:
        recv_until(ws,lambda m:m['type']=='snapshot')
        before=client.get(f'/api/scenes/{test_scene}',headers=gm).json()
        assert command(ws,'wall.add',wall_payload(**{flag:bad}))['type']=='error'
        assert client.get(f'/api/scenes/{test_scene}',headers=gm).json()==before


@pytest.mark.parametrize('state', ['open','closed','locked'])
@pytest.mark.parametrize('movement', [False,True])
def test_door_state_overrides_legacy_movement_flag(state,movement):
    door=SimpleNamespace(kind='door',door_state=state,blocks_movement=movement,x1=350,y1=0,x2=350,y2=350)
    assert path_blocked(100,100,600,100,[door]) is (state!='open')


@pytest.mark.parametrize('bad', [float('nan'),float('inf'),-1,801,True,'200'])
def test_invalid_transparent_window_is_not_ignored(bad):
    scene=SimpleNamespace(id='s',width=800,height=600)
    window=SimpleNamespace(scene_id='s',kind='window',blocks_sight=False,x1=bad,y1=0,x2=200,y2=300)
    with pytest.raises(SceneGeometryUnavailable):
        prepare_scene_geometry(scene,[window])


@pytest.mark.parametrize('bad', [None,0,'false'])
def test_ambiguous_window_sight_is_unavailable(bad):
    scene=SimpleNamespace(id='s',width=800,height=600)
    window=SimpleNamespace(scene_id='s',kind='window',blocks_sight=bad,x1=200,y1=0,x2=200,y2=300)
    with pytest.raises(SceneGeometryUnavailable):
        prepare_scene_geometry(scene,[window])


def test_window_updates_personal_rest_ws_media_and_denies_player_edit(client,gm,room):
    with client.websocket_connect(f'/ws/scene/{room.scene}',headers=gm) as master, \
         client.websocket_connect(f'/ws/scene/{room.scene}',headers=room.headers[0]) as player:
        recv_until(master,lambda m:m['type']=='snapshot');recv_until(player,lambda m:m['type']=='snapshot')
        owned=command(master,'wall.add',{'x1':50,'y1':0,'x2':50,'y2':80})['payload']['wall']
        before=rest(client,room)
        for name,payload in [('wall.add',wall_payload()),
                             ('wall.update',{'id':room.door,'blocks_sight':False}),
                             ('wall.remove',{'id':owned['id']})]:
            assert command(player,name,payload)['type']=='error'
            assert rest(client,room)==before
        for sight in (False,True,False,True):
            event=command(master,'wall.update',{'id':room.door,'kind':'window',
                                                'blocks_sight':sight,'blocks_movement':True})
            assert event['name']=='wall.updated'
            delivered=recv_until(player,lambda m:m['type']=='event' and m.get('seq')==event['seq'])
            assert delivered['name']=='wall.updated' and delivered['cmd_id']==event['cmd_id']
            snapshot=recv_until(player,lambda m:m['type']=='snapshot' and m['seq']==event['seq'])['scene']
            assert (room.obscured in ids(snapshot)) is not sight
            assert (room.obscured in ids(rest(client,room))) is not sight
            assert room.obscured in ids(rest(client,room,1)), 'personal, not shared vision'
            assert room.hidden not in json.dumps(snapshot)
            assert client.get(room.files['portrait'],headers=room.headers[0]).status_code==(404 if sight else 200)
            assert client.get(room.files['portrait'],headers=room.headers[1]).status_code==200
            assert client.get(room.files['private'],headers=room.headers[1]).status_code==404
        # Opaque window revokes new Range/HEAD requests and reconnect snapshots too.
        for method,extra in [('HEAD',{}),('GET',{'Range':'bytes=0-7'})]:
            assert client.request(method,room.files['portrait'],headers={**room.headers[0],**extra}).status_code==404
    with client.websocket_connect(f'/ws/scene/{room.scene}',headers=room.headers[0]) as player:
        assert room.obscured not in ids(recv_until(player,lambda m:m['type']=='snapshot')['scene'])


def test_hidden_window_geometry_never_leaks_and_move_visibility_marks_are_correct(client,gm,room):
    with client.websocket_connect(f'/ws/scene/{room.scene}',headers=gm) as master, \
         client.websocket_connect(f'/ws/scene/{room.scene}',headers=room.headers[0]) as player:
        recv_until(master,lambda m:m['type']=='snapshot');recv_until(player,lambda m:m['type']=='snapshot')
        command(master,'fog.cover',{'x':240,'y':0,'w':20,'h':1000})
        before=rest(client,room)
        assert room.door not in json.dumps(before['walls'])
        changed=command(master,'wall.update',{'id':room.door,'kind':'window','blocks_sight':False})
        event=recv_until(player,lambda m:m['type']=='event' and m.get('seq')==changed['seq'])
        assert event['name']=='noop' and event['payload']=={} and event['cmd_id'] is None
        assert room.door not in json.dumps(rest(client,room)['walls'])
        # Moving out of/into manual FoW emits add/remove, not the hidden old geometry.
        moved=command(master,'wall.update',{'id':room.door,'x1':450,'x2':450})
        event=recv_until(player,lambda m:m['type']=='event' and m.get('seq')==moved['seq'])
        assert event['name']=='wall.added' and event['payload']['wall']['x1']==450
        hidden=command(master,'wall.update',{'id':room.door,'x1':250,'x2':250})
        event=recv_until(player,lambda m:m['type']=='event' and m.get('seq')==hidden['seq'])
        assert event['name']=='wall.removed' and event['payload']=={'id':room.door}
    with client.websocket_connect(f'/ws/scene/{room.scene}',headers=room.headers[0]) as player:
        assert room.door not in json.dumps(recv_until(player,lambda m:m['type']=='snapshot')['scene']['walls'])


def test_late_window_result_cannot_restore_transparent_projection(client,room,monkeypatch):
    async def check():
        async with SessionLocal() as db:
            wall=await db.get(Wall,room.door)
            wall.kind,wall.blocks_sight='window',False
            await db.commit()
        entered,release=anyio.Event(),anyio.Event()
        original=main.calculate_bounded
        calls=0
        async def held(*args):
            nonlocal calls
            result=await original(*args);calls+=1
            if calls==1:
                assert room.obscured in result.ids
                entered.set();await release.wait()
            return result
        monkeypatch.setattr(main,'calculate_bounded',held)
        from app import auth
        from app.recipient_projection import recipient
        async with SessionLocal() as db:
            actor=(await recipient(db,auth.session_id(room.sessions[0]),scene_id=room.scene))[0]
        result=[]
        async def request():
            async with SessionLocal() as db:
                result.append(await main.scene_snapshot(db,room.scene,actor))
        async with anyio.create_task_group() as group:
            group.start_soon(request);await entered.wait()
            async with SessionLocal() as db:
                (await db.get(Wall,room.door)).blocks_sight=True  # No seq change.
                await db.commit()
            release.set()
        assert calls==2 and room.obscured not in ids(result[0])
    client.portal.call(check)
