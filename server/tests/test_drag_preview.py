"""Bounded ephemeral streams and privacy, without a database write API."""
import asyncio
import json
from types import SimpleNamespace as N
from uuid import uuid4
import pytest
from app.drag_preview import DragPreviews
from app.handlers import CommandError


def fixture(layer='tokens', fog=None):
    source, gm, other = object(), object(), object()
    owner=N(id='owner',name='Owner',is_gm=False)
    master=N(id='gm',name='GM',is_gm=True)
    observer=N(id='other',name='Other',is_gm=False)
    scene=N(id='scene',seq=5,width=4000,height=3000,fog_json=json.dumps(fog or []))
    token=N(id='token',scene_id='scene',x=100,y=100,owner_id='owner',layer=layer,image_url='NEVER SEND IMAGE')
    class Hub:
        def __init__(self):self.messages={source:[],gm:[],other:[]}
        def connections(self):return [('scene',source,owner),('scene',gm,master),('scene',other,observer)]
        async def send(self,ws,m):self.messages[ws].append(dict(m))
    class DB:
        reads=0
        async def get(self,model,id):self.reads+=1;return token if id=='token' else None
    hub=Hub();now=[100.0];broker=DragPreviews(hub,lambda:now[0]);db=DB()
    payload={'id':'token','drag_id':str(uuid4()),'step':1,'base_seq':5,'x':200,'y':100}
    return N(**locals())


def test_preview_order_rate_confirm_end_and_read_only_state():
    async def run():
        f=fixture();b=f.broker;p=f.payload
        assert b.allowed(f.source) and not b.allowed(f.source)
        await b.handle(f.db,f.scene,f.owner,f.source,p)
        assert f.hub.messages[f.gm]==f.hub.messages[f.other]
        assert 'NEVER SEND IMAGE' not in json.dumps(f.hub.messages[f.gm])
        assert not f.hub.messages[f.source]
        await b.handle(f.db,f.scene,f.owner,f.source,p)
        await b.handle(f.db,f.scene,f.owner,f.source,{**p,'step':2,'base_seq':4})
        assert len(f.hub.messages[f.gm])==1
        f.now[0]+=.11;assert b.allowed(f.source)
        await b.handle(f.db,f.scene,f.owner,f.source,{**p,'step':3,'x':250})
        assert f.hub.messages[f.gm][-1]['x']==250
        assert (f.token.x,f.token.y,f.scene.seq)==(100,100,5)
        await b.clear_token('scene','token')
        assert f.hub.messages[f.gm][-1]['end'] and f.hub.messages[f.gm][-1]['final']
        count=len(f.hub.messages[f.gm]);f.scene.seq=6
        await b.handle(f.db,f.scene,f.owner,f.source,{**p,'step':99,'base_seq':6})
        assert len(f.hub.messages[f.gm])==count
        await b.handle(f.db,f.scene,f.owner,f.source,{**p,'drag_id':str(uuid4()),'base_seq':6})
        assert len(f.hub.messages[f.gm])==count+1
    asyncio.run(run())


@pytest.mark.parametrize('hidden',['gm','origin','destination'])
def test_preview_never_discloses_hidden_id_coordinates_or_images(hidden):
    async def run():
        regions=[{'id':'fog','x':90 if hidden=='origin' else 190,'y':90,'w':30,'h':30}] if hidden!='gm' else []
        f=fixture(layer='gm' if hidden=='gm' else 'tokens',fog=regions)
        await f.broker.handle(f.db,f.scene,f.master if hidden=='gm' else f.owner,f.source,f.payload)
        assert f.hub.messages[f.gm] and not f.hub.messages[f.other]
    asyncio.run(run())


def test_preview_hiding_only_stops_known_stream_and_can_reappear():
    async def run():
        f=fixture(fog=[{'id':'fog','x':290,'y':90,'w':40,'h':40}]);b=f.broker;p=f.payload
        await b.handle(f.db,f.scene,f.owner,f.source,p)
        await b.handle(f.db,f.scene,f.owner,f.source,{**p,'step':2,'x':300})
        stop=f.hub.messages[f.other][-1]
        assert stop['end'] and stop['final'] is False and 'x' not in stop and 'y' not in stop
        await b.handle(f.db,f.scene,f.owner,f.source,{**p,'step':3,'x':220})
        assert f.hub.messages[f.other][-1]['x']==220
    asyncio.run(run())


def test_preview_timeout_resume_disconnect_and_new_session():
    async def run():
        f=fixture();b=f.broker;p=f.payload
        await b.handle(f.db,f.scene,f.owner,f.source,p)
        f.now[0]+=2.1;await b.expire()
        assert not b.streams and f.hub.messages[f.gm][-1]['final'] is False
        size=len(f.hub.messages[f.gm])
        await b.handle(f.db,f.scene,f.owner,f.source,p)
        assert len(f.hub.messages[f.gm])==size
        await b.handle(f.db,f.scene,f.owner,f.source,{**p,'step':2})
        assert b.streams
        await b.drop_socket(f.source)
        assert not b.streams and f.hub.messages[f.gm][-1]['final']
        await b.handle(f.db,f.scene,f.owner,f.source,{**p,'drag_id':str(uuid4())})
        assert b.streams
        await b.clear_scene('scene');assert not b.streams
    asyncio.run(run())


@pytest.mark.parametrize('value',[True,float('inf'),float('nan'),'100'])
def test_preview_coordinates_and_ownership_are_validated(value):
    async def run():
        f=fixture()
        with pytest.raises(CommandError):await f.broker.handle(f.db,f.scene,f.owner,f.source,{**f.payload,'x':value})
        f.token.owner_id='someone-else'
        with pytest.raises(CommandError):await f.broker.handle(f.db,f.scene,f.owner,f.source,f.payload)
        assert not f.broker.streams
    asyncio.run(run())


def test_scene_switch_cannot_resurrect_preview_awaiting_database_read():
    async def run():
        f=fixture();entered=asyncio.Event();release=asyncio.Event()
        async def get(model,id):entered.set();await release.wait();return f.token
        f.db.get=get
        pending=asyncio.create_task(f.broker.handle(f.db,f.scene,f.owner,f.source,f.payload))
        await entered.wait();await f.broker.clear_scene('scene');release.set();await pending
        assert not f.broker.streams and not f.hub.messages[f.gm] and not f.hub.messages[f.other]
    asyncio.run(run())
