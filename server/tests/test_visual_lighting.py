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
