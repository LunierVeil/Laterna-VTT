import json
import pytest
from app import visual_lighting, config
from .test_handlers import client, gm, run, recv_until  # noqa: F401
from .test_pb02_projection import world  # noqa: F401

@pytest.fixture(autouse=True)
def experimental(monkeypatch,world):
    monkeypatch.setattr(config,'EXPERIMENTAL_VISIBILITY',True)
    yield
    visual_lighting.clear()


def test_transient_lighting_is_explicit_gm_only_and_does_not_change_projection(client,gm,world):
    url=f'/api/scenes/{world.scene}'
    before=client.get(url,headers=world.headers[0]).json()
    assert before['visuals']['settings'] is None
    settings={'ambient':'none','sources':[{'x':100,'y':100,'radius':200}]}
    with client.websocket_connect(f'/ws/scene/{world.scene}',headers=gm) as master, client.websocket_connect(f'/ws/scene/{world.scene}',headers=world.headers[0]) as player:
        recv_until(master,lambda m:m['type']=='snapshot');recv_until(player,lambda m:m['type']=='snapshot')
        assert run(player,'denied','scene.visuals',{'settings':settings})['type']=='error'
        assert run(master,'set','scene.visuals',{'settings':settings})['type']=='reply'
        snap=recv_until(player,lambda m:m['type']=='snapshot')['scene']
        assert snap['seq']==before['seq'] and snap['tokens']==before['tokens'] and snap['fog']==before['fog']
        assert snap['visuals']=={'settings':settings,'observer_id':world.own}
    assert client.get(url,headers=world.headers[0]).json()['visuals']['settings']==settings
    visual_lighting.clear()  # restart/reset has no persisted source to recover
    assert client.get(url,headers=gm).json()['visuals']['settings'] is None


@pytest.mark.parametrize('settings',[{}, {'ambient':'auto','sources':[]}, {'ambient':'none','sources':[{}]},
    {'ambient':'none','sources':[{'x':True,'y':0,'radius':10}]},
    {'ambient':'full','sources':[{'x':0,'y':0,'radius':float('inf')}]},
    {'ambient':'none','sources':[{'x':-1,'y':0,'radius':10}]},
    {'ambient':'none','sources':[{'x':0,'y':0,'radius':0}]},
    {'ambient':'none','sources':[{'x':0,'y':0,'radius':1}]*16}])
def test_invalid_visual_inputs_preserve_previous_settings(client,gm,world,settings):
    with client.websocket_connect(f'/ws/scene/{world.scene}',headers=gm) as master:
        recv_until(master,lambda m:m['type']=='snapshot')
        assert run(master,'bad','scene.visuals',{'settings':settings})['type']=='error'
    assert client.get(f'/api/scenes/{world.scene}',headers=gm).json()['visuals']['settings'] is None


def test_flag_off_keeps_legacy_snapshot_and_rejects_adapter(client,gm,world,monkeypatch):
    monkeypatch.setattr(config,'EXPERIMENTAL_VISIBILITY',False)
    assert 'visuals' not in client.get(f'/api/scenes/{world.scene}',headers=gm).json()
    with client.websocket_connect(f'/ws/scene/{world.scene}',headers=gm) as master:
        recv_until(master,lambda m:m['type']=='snapshot')
        assert run(master,'off','scene.visuals',{'settings':{'ambient':'full','sources':[]}})['type']=='error'


def test_unsupported_geometry_never_implicitly_selects_window_optics(client,gm,world):
    from app.models import Wall
    from app.db import SessionLocal
    async def seed():
        async with SessionLocal() as db:
            wall=Wall(scene_id=world.scene,x1=200,y1=0,x2=200,y2=500,kind='window')
            db.add(wall);await db.commit();return wall.id
    wid=client.portal.call(seed)
    try:
        with client.websocket_connect(f'/ws/scene/{world.scene}',headers=gm) as master:
            recv_until(master,lambda m:m['type']=='snapshot')
            assert run(master,'full','scene.visuals',{'settings':{'ambient':'full','sources':[]}})['type']=='reply'
        projection=client.get(f'/api/scenes/{world.scene}',headers=world.headers[0]).json()
        assert projection['visuals']['observer_id'] is None
        assert [t['id'] for t in projection['tokens']]==[world.own]
    finally:
        async def cleanup():
            async with SessionLocal() as db:
                await db.delete(await db.get(Wall,wid));await db.commit()
        client.portal.call(cleanup)


def test_manual_fog_revokes_visual_observer_even_when_token_ids_do_not_change(client,gm,world):
    from app.models import Scene, Wall
    from app.db import SessionLocal
    async def original_fog():
        async with SessionLocal() as db:
            return (await db.get(Scene,world.scene)).fog_json
    before=client.portal.call(original_fog)
    wid=None
    try:
        with client.websocket_connect(f'/ws/scene/{world.scene}',headers=gm) as master, client.websocket_connect(f'/ws/scene/{world.scene}',headers=world.headers[0]) as player:
            recv_until(master,lambda m:m['type']=='snapshot');recv_until(player,lambda m:m['type']=='snapshot')
            wall=run(master,'visual-wall','wall.add',{'x1':50,'y1':50,'x2':150,'y2':50})
            wid=wall['payload']['wall']['id']
            assert run(master,'enable','scene.visuals',{'settings':{'ambient':'full','sources':[]}})['type']=='reply'
            initial=recv_until(player,lambda m:m['type']=='snapshot')['scene']
            assert initial['visuals']['observer_id']==world.own
            covered=run(master,'cover-wall','fog.cover',{'x':40,'y':40,'w':120,'h':20})
            current=recv_until(player,lambda m:m['type']=='snapshot' and m['seq']==covered['seq'])['scene']
            assert {t['id'] for t in current['tokens']}=={t['id'] for t in initial['tokens']}
            assert current['visuals']['observer_id'] is None
            assert wid not in {w['id'] for w in current['walls']}
    finally:
        async def restore():
            async with SessionLocal() as db:
                (await db.get(Scene,world.scene)).fog_json=before
                if wid: await db.delete(await db.get(Wall,wid))
                await db.commit()
        client.portal.call(restore)
