"""Real REST/WS/media boundaries, opt-in PB-02; synthetic owned temporary data.

No LOS assertion yet: this first slice preserves GM layer/manual FoW semantics.
"""
from __future__ import annotations

import json
import uuid
import anyio
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from sqlalchemy import delete, select
from sqlalchemy.exc import OperationalError
from starlette.websockets import WebSocketDisconnect

from app import auth, config, main, media_access
from app.db import SessionLocal
from app.models import AuthSession, Campaign, Character, Scene, Token, User
from app.recipient_projection import projection_session, read_snapshot, recipient
from .test_handlers import client, gm, recv_until, run  # noqa: F401

PNG = b'\x89PNG\r\n\x1a\n' + b'synthetic PB-02 image'


@pytest.fixture(scope='module')
def world(client, gm):
    campaign = client.get('/api/campaign', headers=gm).json()
    files = {}
    for key in ('portrait', 'private', 'token', 'fog', 'owned', 'background'):
        response = client.post('/api/uploads', headers=gm, content=PNG)
        assert response.status_code == 200
        files[key] = response.json()['url']

    async def seed():
        async with SessionLocal() as db:
            parent = await main.get_campaign(db)
            users, sessions = [], []
            for _ in range(2):
                user = await auth.create_user(db, parent, 'PB02-' + uuid.uuid4().hex, 'synthetic-password', is_gm=False)
                users.append(user)
                sessions.append(await auth.create_session(db, user))
            scene = Scene(campaign_id=parent.id, name='PB02 synthetic', fog_json=json.dumps([
                {'id': 'fog', 'x': 250, 'y': 250, 'w': 100, 'h': 100}]))
            inactive = Scene(campaign_id=parent.id, name='PB02 private background', background_url=files['background'])
            db.add_all([scene, inactive])
            await db.flush()
            parent.active_scene_id = scene.id
            character = Character(campaign_id=parent.id, name='PB02 secret NPC', system='mob',
                data_json=json.dumps({'portrait': files['portrait'], 'notes': {'image': files['private']}, 'hp': 999}))
            pc = Character(campaign_id=parent.id, owner_id=users[0].id, name='PB02 own PC',
                data_json=json.dumps({'notes': {'image': files['owned']}}))
            pc2 = Character(campaign_id=parent.id, owner_id=users[1].id, name='PB02 second PC', data_json='{}')
            db.add_all([character, pc, pc2])
            await db.flush()
            hidden = Token(scene_id=scene.id, name='PB02 hidden', x=100, y=100, layer='gm',
                           character_id=character.id, image_url=files['token'], hp=87)
            obscured = Token(scene_id=scene.id, name='PB02 fog NPC', x=300, y=300, image_url=files['fog'])
            own = Token(scene_id=scene.id, name='PB02 own in fog', x=300, y=300, owner_id=users[0].id, character_id=pc.id)
            other = Token(scene_id=scene.id, name='PB02 second PC', x=500, y=500, owner_id=users[1].id, character_id=pc2.id)
            db.add_all([hidden, obscured, own, other])
            await db.commit()
            return SimpleNamespace(scene=scene.id, inactive=inactive.id, hidden=hidden.id, obscured=obscured.id,
                own=own.id, character=character.id, pc=pc.id, pc2=pc2.id, users=[u.id for u in users], sessions=sessions,
                campaign=parent.id)

    result = client.portal.call(seed)
    result.headers = [{'cookie': f'{auth.SESSION_COOKIE}={raw}'} for raw in result.sessions]
    result.files = files
    yield result

    async def cleanup():
        async with SessionLocal() as db:
            parent = await db.get(Campaign, result.campaign)
            parent.active_scene_id = campaign['active_scene_id']
            for sid in (result.scene, result.inactive):
                await db.delete(await db.get(Scene, sid))
            await db.execute(delete(Character).where(Character.id.in_([result.character, result.pc, result.pc2])))
            await db.execute(delete(AuthSession).where(AuthSession.user_id.in_(result.users)))
            await db.execute(delete(User).where(User.id.in_(result.users)))
            await db.commit()
    client.portal.call(cleanup)
    for url in files.values():
        (config.UPLOAD_DIR / url.rsplit('/', 1)[-1]).unlink(missing_ok=True)


@pytest.fixture(autouse=True)
def experimental(monkeypatch, world):
    monkeypatch.setattr(config, 'EXPERIMENTAL_VISIBILITY', True)


def test_rest_ws_resync_and_private_character_projection(client, gm, world):
    full = client.get(f'/api/scenes/{world.scene}', headers=gm)
    assert full.status_code == 200
    assert world.hidden in {t['id'] for t in full.json()['tokens']}
    for headers in world.headers:
        response = client.get(f'/api/scenes/{world.scene}', headers=headers)
        assert response.headers['cache-control'] == 'private, no-store'
        assert world.hidden not in response.text and world.character not in response.text
        assert 'PB02 secret NPC' not in client.get('/api/characters', headers=headers).text
        assert client.get(f'/api/scenes/{world.inactive}', headers=headers).status_code == 404
        # Reconnecting obtains the same filtered snapshot as REST resync.
        for _ in range(2):
            with client.websocket_connect(f'/ws/scene/{world.scene}', headers=headers) as ws:
                snapshot = ws.receive_json()
                assert snapshot['type'] == 'snapshot'
                assert world.hidden not in json.dumps(snapshot)
                assert world.obscured not in json.dumps(snapshot)
    first = client.get(f'/api/scenes/{world.scene}', headers=world.headers[0]).json()
    second = client.get(f'/api/scenes/{world.scene}', headers=world.headers[1]).json()
    assert world.own in {t['id'] for t in first['tokens']}
    assert world.own not in {t['id'] for t in second['tokens']}


def test_hidden_event_noop_reveal_revoke_and_media(client, gm, world):
    with client.websocket_connect(f'/ws/scene/{world.scene}', headers=gm) as g, \
         client.websocket_connect(f'/ws/scene/{world.scene}', headers=world.headers[0]) as p:
        assert g.receive_json()['type'] == p.receive_json()['type'] == 'snapshot'
        event = run(g, 'pb02-secret', 'token.update', {'id': world.hidden, 'name': 'PB02 unreleased'})
        noop = recv_until(p, lambda m: m.get('seq') == event['seq'])
        assert noop['name'] == 'noop' and noop['payload'] == {} and not noop.get('cmd_id')
        for key in ('portrait', 'private', 'token', 'fog', 'background'):
            assert client.get(world.files[key], headers=world.headers[0]).status_code == 404
            assert client.get(world.files[key], headers=gm).status_code == 200
        try:
            reveal = run(g, 'pb02-reveal', 'token.update', {'id': world.hidden, 'layer': 'tokens'})
            added = recv_until(p, lambda m: m.get('seq') == reveal['seq'])
            assert added['name'] == 'token.added'
            assert added['payload']['token']['portrait_url'] == world.files['portrait']
            assert added['payload']['token'].get('hp') is None
            # Existing UI permits reusing an already shared portrait. This is
            # different from laundering a still-private URL without permission.
            copied = run(p, 'pb02-copy-visible-portrait', 'token.update',
                         {'id': world.own, 'image_url': world.files['portrait']})
            assert copied['name'] == 'token.updated'
            run(p, 'pb02-copy-clean', 'token.update', {'id': world.own, 'image_url': None})
            for headers in world.headers:
                for key in ('portrait', 'token'):
                    allowed = client.get(world.files[key], headers=headers)
                    assert allowed.status_code == 200 and allowed.content == PNG
                    assert allowed.headers['cache-control'] == 'private, no-store'
                # Seeing the portrait never grants access to the NPC sheet's private attachments.
                assert client.get(world.files['private'], headers=headers).status_code == 404
            previous = client.get(world.files['portrait'], headers=world.headers[0])
        finally:
            hide = run(g, 'pb02-hide', 'token.update', {'id': world.hidden, 'layer': 'gm'})
            removed = recv_until(p, lambda m: m.get('seq') == hide['seq'])
            assert removed['name'] == 'token.removed' and removed['payload'] == {'id': world.hidden}
        for headers in world.headers:
            for method, conditional in [('GET', {}), ('HEAD', {}), ('GET', {'Range': 'bytes=0-7'}),
                                        ('GET', {'If-None-Match': previous.headers['etag']})]:
                denied = client.request(method, world.files['portrait'], headers={**headers, **conditional})
                assert denied.status_code == 404
                assert denied.headers['cache-control'] == 'private, no-store'
        assert world.hidden not in client.get(f'/api/scenes/{world.scene}', headers=world.headers[0]).text


def test_authentication_scope_and_unplaced_owned_editor_image(client, gm, world):
    for key in world.files:
        url = world.files[key]
        assert client.get(url).status_code == 404
        assert client.get(url, headers={'cookie': f'{auth.SESSION_COOKIE}=invalid'}).status_code == 404
    assert client.get(world.files['owned'], headers=world.headers[0]).status_code == 200
    assert client.get(world.files['owned'], headers=world.headers[1]).status_code == 404
    assert client.get(world.files['owned'], headers=gm).status_code == 200


def test_known_ids_do_not_allow_mutating_hidden_tokens(client, world):
    headers = world.headers[0]
    before = client.get(f'/api/scenes/{world.scene}', headers=headers).json()
    with client.websocket_connect(f'/ws/scene/{world.scene}', headers=headers) as ws:
        assert ws.receive_json()['type'] == 'snapshot'
        for token_id in (world.hidden, world.obscured, 'unknown-token'):
            for name, payload in [('token.update', {'id': token_id, 'name': 'forbidden'}),
                                  ('token.move', {'id': token_id, 'x': 10, 'y': 10}),
                                  ('token.remove', {'id': token_id}),
                                  ('combat.add', {'token_id': token_id})]:
                response = run(ws, f'pb02-denied-{token_id}-{name}', name, payload)
                assert response['type'] == 'error' and response['message'] == 'объект недоступен'
    assert client.get(f'/api/scenes/{world.scene}', headers=headers).json() == before


def test_combat_snapshot_and_event_do_not_leak_obscured_token(client, gm, world):
    with client.websocket_connect(f'/ws/scene/{world.scene}', headers=gm) as g, \
         client.websocket_connect(f'/ws/scene/{world.scene}', headers=world.headers[0]) as p:
        assert g.receive_json()['type'] == p.receive_json()['type'] == 'snapshot'
        try:
            event = run(g, 'pb02-fog-combat', 'combat.add', {'token_id': world.obscured})
            projected = recv_until(p, lambda m: m.get('seq') == event['seq'])
            assert projected['payload']['combat']['entries'] == []
            assert world.obscured not in json.dumps(projected)
            assert '__visibility' not in json.dumps(event)
            assert event['payload']['combat']['entries'][0]['token_id'] == world.obscured
            entry = event['payload']['combat']['entries'][0]['id']
            for headers in world.headers:
                rest = client.get(f'/api/scenes/{world.scene}', headers=headers)
                assert rest.json()['combat']['entries'] == []
                assert world.obscured not in rest.text
            denied = run(p, 'pb02-hidden-combat-roll', 'combat.roll', {'entry_id': entry, 'bonus': 0})
            assert denied['type'] == 'error' and denied['message'] == 'объект недоступен'
        finally:
            run(g, 'pb02-combat-clean', 'combat.end', {})


def test_pending_upload_is_session_bound_and_attaching_revokes_grant(client, gm, world, monkeypatch):
    uploaded = client.post('/api/uploads', headers=world.headers[0], content=PNG)
    assert uploaded.status_code == 200
    url = uploaded.json()['url']
    name = url.rsplit('/', 1)[-1]
    try:
        assert client.get(url, headers=world.headers[0]).status_code == 200
        assert client.get(url, headers=world.headers[1]).status_code == 404
        assert client.get(url, headers=gm).status_code == 404
        async def attach():
            async with SessionLocal() as db:
                token = await db.get(Token, world.hidden)
                token.image_url = url
                await db.commit()
        client.portal.call(attach)
        assert client.get(url, headers=world.headers[0]).status_code == 404
        assert client.get(url, headers=gm).status_code == 200
        async def detach():
            async with SessionLocal() as db:
                token = await db.get(Token, world.hidden)
                token.image_url = world.files['token']
                await db.commit()
        client.portal.call(detach)
        monkeypatch.setattr(media_access, 'monotonic', lambda: float('inf'))
        assert client.get(url, headers=world.headers[0]).status_code == 404
    finally:
        client.portal.call(detach)
        (config.UPLOAD_DIR / name).unlink(missing_ok=True)
        media_access._pending.pop(name, None)


def test_reference_union_and_active_background(client, gm, world):
    async def set_background(url):
        async with SessionLocal() as db:
            scene = await db.get(Scene, world.scene)
            scene.background_url = url
            await db.commit()
    try:
        # A file already legitimately shared as an active map is not secret bytes,
        # even if a hidden object references it too. The object's ID stays hidden.
        client.portal.call(set_background, world.files['private'])
        assert client.get(world.files['private'], headers=world.headers[1]).status_code == 200
        assert world.hidden not in client.get(f'/api/scenes/{world.scene}', headers=world.headers[1]).text
    finally:
        client.portal.call(set_background, None)
    assert client.get(world.files['private'], headers=world.headers[1]).status_code == 404


def test_player_cannot_launder_private_url_through_owned_token_or_sheet(client, world):
    headers = world.headers[0]
    before = client.get(f'/api/scenes/{world.scene}', headers=headers).json()
    with client.websocket_connect(f'/ws/scene/{world.scene}', headers=headers) as ws:
        assert ws.receive_json()['type'] == 'snapshot'
        for index, key in enumerate(('portrait', 'private', 'background')):
            denied = run(ws, f'pb02-launder-token-{index}', 'token.update',
                         {'id': world.own, 'image_url': world.files[key]})
            assert denied['type'] == 'error' and denied['message'] == 'изображение недоступно'
            denied_sheet = run(ws, f'pb02-launder-sheet-{index}', 'character.update',
                               {'id': world.pc, 'set': {'portrait': world.files[key]}})
            assert denied_sheet['type'] == 'error' and denied_sheet['message'] == 'изображение недоступно'
            assert client.get(world.files[key], headers=headers).status_code == 404
        # A denied command changes neither stored projection nor scene seq.
        after = client.get(f'/api/scenes/{world.scene}', headers=headers).json()
        assert after == before
        own = next(c for c in client.get('/api/characters', headers=headers).json() if c['id'] == world.pc)
        assert 'portrait' not in own['data']
        # Normal editor flow with an actual upload remains usable.
        uploaded = client.post('/api/uploads', headers=headers, content=PNG).json()['url']
        try:
            accepted = run(ws, 'pb02-allowed-image', 'token.update', {'id': world.own, 'image_url': uploaded})
            assert accepted['name'] == 'token.updated'
            assert client.get(uploaded, headers=headers).status_code == 200
        finally:
            run(ws, 'pb02-clean-image', 'token.update', {'id': world.own, 'image_url': None})
            (config.UPLOAD_DIR / uploaded.rsplit('/', 1)[-1]).unlink(missing_ok=True)
            media_access._pending.pop(uploaded.rsplit('/', 1)[-1], None)


def test_fail_closed_budgets_malformed_data_and_db_failure(client, gm, world, monkeypatch):
    with monkeypatch.context() as m:
        m.setattr(media_access, 'MAX_MATCHES', 0)
        assert client.get(world.files['owned'], headers=world.headers[0]).status_code == 404
    with monkeypatch.context() as m:
        m.setattr(media_access, 'MAX_JSON_BYTES', 1)
        assert client.get(world.files['owned'], headers=world.headers[0]).status_code == 404
    async def unavailable(*args):
        raise OperationalError('synthetic unavailable', {}, Exception())
    with monkeypatch.context() as m:
        m.setattr(media_access, 'allowed_upload', unavailable)
        assert client.get(world.files['owned'], headers=gm).status_code == 404
    async def timed_out(*args):
        raise TimeoutError()
    with monkeypatch.context() as m:
        m.setattr(media_access, 'allowed_upload', timed_out)
        assert client.get(world.files['owned'], headers=gm).status_code == 404
    with pytest.raises(ValueError):
        media_access._character_references('{invalid', '/uploads/test.png')
    assert media_access._character_references(json.dumps({'other': world.files['owned'] + '?extra'}), world.files['owned']) == (False, False)
    for name in ('%2e%2e/secret.txt', 'not-an-upload.png', 'folder/' + world.files['owned'].rsplit('/', 1)[-1]):
        assert client.get('/uploads/' + name, headers=gm).status_code == 404


def test_revoked_expired_foreign_and_changed_role_sessions(client, gm, world):
    async def create_session():
        async with SessionLocal() as db:
            user = await db.get(User, world.users[0])
            raw = await auth.create_session(db, user)
            await db.commit()
            return raw
    async def revoke(raw, expire=False):
        async with SessionLocal() as db:
            session = await db.get(AuthSession, auth.session_id(raw))
            if expire:
                session.created_at = datetime.now(timezone.utc) - timedelta(days=31)
            else:
                await db.delete(session)
            await db.commit()
    raw = client.portal.call(create_session)
    headers = {'cookie': f'{auth.SESSION_COOKIE}={raw}'}
    with client.websocket_connect(f'/ws/scene/{world.scene}', headers=headers) as ws:
        assert ws.receive_json()['type'] == 'snapshot'
        client.portal.call(revoke, raw)
        # A fresh outgoing guard must reject a queued private DTO after revocation.
        client.portal.call(main.hub.broadcast, world.scene, {'type': 'character', 'character': {'secret': 'must-not-arrive'}})
        assert recv_until(ws, lambda m: m.get('type') in ('character', 'auth_required')) == {'type': 'auth_required'}
    assert client.get(world.files['owned'], headers=headers).status_code == 404
    expired = client.portal.call(create_session)
    client.portal.call(revoke, expired, True)
    expired_headers = {'cookie': f'{auth.SESSION_COOKIE}={expired}'}
    assert client.get(world.files['owned'], headers=expired_headers).status_code == 404
    assert client.get('/api/characters', headers=expired_headers).status_code == 401

    async def foreign_campaign():
        async with SessionLocal() as db:
            # A later campaign with a lower PK must never become the primary
            # merely because SQLite chooses a covering PK index for SELECT id.
            campaign = Campaign(id='00000000-0000-0000-0000-000000000000', name='PB02 foreign')
            db.add(campaign)
            await db.flush()
            user = await auth.create_user(db, campaign, 'foreign', 'synthetic-password', is_gm=True)
            raw = await auth.create_session(db, user)
            await db.commit()
            return campaign.id, user.id, raw
    cid, uid, raw = client.portal.call(foreign_campaign)
    try:
        headers = {'cookie': f'{auth.SESSION_COOKIE}={raw}'}
        assert client.get('/api/characters', headers=headers).status_code == 401
        assert client.get(world.files['private'], headers=headers).status_code == 404
        with client.websocket_connect(f'/ws/scene/{world.scene}', headers=headers) as ws:
            assert ws.receive_json() == {'type': 'auth_required'}
    finally:
        async def cleanup():
            async with SessionLocal() as db:
                await db.execute(delete(AuthSession).where(AuthSession.user_id == uid))
                await db.execute(delete(User).where(User.id == uid))
                await db.execute(delete(Campaign).where(Campaign.id == cid))
                await db.commit()
        client.portal.call(cleanup)


def test_read_transaction_and_identity_map_cannot_mask_role_change(client, world):
    async def check():
        async with SessionLocal() as cached:
            # Hold an ORM identity across an independent committed change.
            user = await cached.get(User, world.users[0])
            assert not user.is_gm
            previous = await recipient(cached, auth.session_id(world.sessions[0]))
            async with SessionLocal() as writer:
                other = await writer.get(User, user.id)
                other.is_gm = True
                await writer.commit()
            try:
                fresh = await recipient(cached, auth.session_id(world.sessions[0]))
                assert fresh[0].is_gm
                assert not await main.recipient_current(world.scene, previous[0], {'type': 'character'})
                await read_snapshot(cached)
                connection = await cached.connection()
                raw = await connection.get_raw_connection()
                assert raw.driver_connection.in_transaction
            finally:
                await cached.rollback()
                async with SessionLocal() as writer:
                    other = await writer.get(User, world.users[0])
                    other.is_gm = False
                    await writer.commit()
    client.portal.call(check)


def test_legacy_opt_out_preserves_pb00_upload_characterization(client, gm, world, monkeypatch):
    monkeypatch.setattr(config, 'EXPERIMENTAL_VISIBILITY', False)
    # Existing PB-00 GAP stays AS-IS until opt-in protection becomes the default.
    assert client.get(world.files['private']).status_code == 200


def test_cancelled_snapshot_releases_sqlite_reader_before_next_write(client, world):
    async def check():
        finished = anyio.Event()

        async def reader(*, task_status):
            with anyio.CancelScope() as scope:
                async with projection_session() as db:
                    await read_snapshot(db)
                    assert await db.scalar(select(Scene.id).where(Scene.id == world.scene)) == world.scene
                    task_status.started(scope)
                    await anyio.sleep_forever()
            finished.set()

        async with anyio.create_task_group() as group:
            scope = await group.start(reader)
            scope.cancel()
            await finished.wait()
        # No sleeps/retries: the cancelled request must already have released its read lock.
        async with SessionLocal() as db:
            scene = await db.get(Scene, world.scene)
            scene.name = 'PB02 after cancelled reader'
            await db.commit()
    client.portal.call(check)


def test_websocket_disconnect_during_snapshot_releases_read_transaction(client, world, monkeypatch):
    original = main._scene_snapshot
    entered = client.portal.call(anyio.Event)

    async def held(*args):
        result = await original(*args)
        entered.set()
        await anyio.sleep_forever()
        return result

    monkeypatch.setattr(main, '_scene_snapshot', held)
    with client.websocket_connect(f'/ws/scene/{world.scene}', headers=world.headers[0]):
        client.portal.call(entered.wait)
        # Disconnect at an exact barrier with an active physical read, not after a sleep.

    async def write():
        async with SessionLocal() as db:
            scene = await db.get(Scene, world.scene)
            scene.name = 'PB02 after disconnect inside snapshot'
            await db.commit()
    client.portal.call(write)


@pytest.fixture
def publication_identity(client, world):
    """Fresh synthetic identities; revocation/demotion cannot affect other tests."""
    identities = []

    def create(is_gm):
        async def seed():
            async with SessionLocal() as db:
                campaign = await db.get(Campaign, world.campaign)
                user = await auth.create_user(db, campaign, 'publication-' + uuid.uuid4().hex,
                                              'synthetic-password', is_gm=is_gm)
                raw = await auth.create_session(db, user)
                await db.commit()
                return SimpleNamespace(id=user.id, raw=raw, headers={'cookie': f'{auth.SESSION_COOKIE}={raw}'})
        identity = client.portal.call(seed)
        identities.append(identity)
        return identity

    yield create
    async def cleanup():
        async with SessionLocal() as db:
            campaign = await db.get(Campaign, world.campaign)
            campaign.active_scene_id = world.scene
            for identity in identities:
                await db.execute(delete(AuthSession).where(AuthSession.user_id == identity.id))
                await db.execute(delete(User).where(User.id == identity.id))
            await db.commit()
    client.portal.call(cleanup)


async def publication_change(world, identity, change):
    async with SessionLocal() as db:
        if change == 'revoke':
            await db.execute(delete(AuthSession).where(AuthSession.token_hash == auth.session_id(identity.raw)))
        elif change == 'role':
            user = await db.get(User, identity.id)
            user.is_gm = False
        else:
            campaign = await db.get(Campaign, world.campaign)
            campaign.active_scene_id = world.inactive
        await db.commit()


async def wait_publication_barrier(event):
    with anyio.fail_after(10):
        await event.wait()


@pytest.mark.parametrize('phase', ['snapshot', 'campaign'])
@pytest.mark.parametrize('change', ['revoke', 'role', 'scene'])
def test_initial_ws_revalidates_unjoined_recipient_before_each_publication(
        client, world, publication_identity, monkeypatch, phase, change):
    identity = publication_identity(is_gm=change != 'scene')
    entered, release = client.portal.call(anyio.Event), client.portal.call(anyio.Event)
    original = main.send_initial
    captures = []

    async def held(ws, sid, actor, message, **kwargs):
        if actor.id == identity.id and message['type'] == phase and not captures:
            captures.append((ws, message))
            entered.set()
            await release.wait()
        return await original(ws, sid, actor, message, **kwargs)

    monkeypatch.setattr(main, 'send_initial', held)
    with client.websocket_connect(f'/ws/scene/{world.scene}', headers=identity.headers) as ws:
        try:
            client.portal.call(wait_publication_barrier, entered)
            assert not client.portal.call(lambda: any(peer is captures[0][0] for _, peer, _ in main.hub.connections()))
            if phase == 'snapshot' and change != 'scene':
                assert world.hidden in json.dumps(captures[0][1]), 'a private GM snapshot was actually prepared'
            if phase == 'campaign':
                first = ws.receive_json()
                assert first['type'] == 'snapshot'  # delivered BEFORE the access change
            # Commit completes while publication is held: no SQLite read lock is
            # held over the network boundary. No sleeps or probabilistic timing.
            client.portal.call(publication_change, world, identity, change)
        finally:
            client.portal.call(release.set)
        denied = ws.receive_json()
        if change == 'scene':
            assert denied['type'] == 'campaign'
            assert denied['active_scene_id'] == world.inactive
            assert world.hidden not in json.dumps(denied)
            expected_close = 4000
        else:
            assert denied == {'type': 'auth_required'}
            expected_close = 4401
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_json()
        assert closed.value.code == expected_close


@pytest.mark.parametrize('change', ['revoke', 'role'])
def test_initial_missing_scene_redirect_does_not_send_stale_private_campaign(
        client, world, publication_identity, monkeypatch, change):
    identity = publication_identity(is_gm=True)
    entered, release = client.portal.call(anyio.Event), client.portal.call(anyio.Event)
    original = main.send_initial
    captures = []

    async def held(ws, sid, actor, message, **kwargs):
        if actor.id == identity.id and not captures:
            captures.append(message)
            entered.set()
            await release.wait()
        return await original(ws, sid, actor, message, **kwargs)

    monkeypatch.setattr(main, 'send_initial', held)
    with client.websocket_connect(f'/ws/scene/{uuid.uuid4()}', headers=identity.headers) as ws:
        try:
            client.portal.call(wait_publication_barrier, entered)
            assert captures[0]['type'] == 'campaign'
            assert captures[0]['scenes'], 'a private GM campaign view was actually captured'
            client.portal.call(publication_change, world, identity, change)
        finally:
            client.portal.call(release.set)
        assert ws.receive_json() == {'type': 'auth_required'}
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_json()
        assert closed.value.code == 4401


@pytest.mark.parametrize('change', ['revoke', 'role', 'scene'])
def test_rest_snapshot_denial_after_precheck_is_uniform_404(
        client, world, publication_identity, monkeypatch, change):
    identity = publication_identity(is_gm=change != 'scene')
    entered, release = client.portal.call(anyio.Event), client.portal.call(anyio.Event)
    original = main.scene_snapshot

    async def held(db, sid, actor):
        if actor.id == identity.id:
            entered.set()
            await release.wait()
        return await original(db, sid, actor)

    monkeypatch.setattr(main, 'scene_snapshot', held)
    with ThreadPoolExecutor(max_workers=1) as executor:
        pending = executor.submit(client.get, f'/api/scenes/{world.scene}', headers=identity.headers)
        try:
            client.portal.call(wait_publication_barrier, entered)
            client.portal.call(publication_change, world, identity, change)
        finally:
            client.portal.call(release.set)
        response = pending.result(timeout=15)
    assert response.status_code == 404
    assert response.json() == {'detail': 'scene not found'}
    assert response.headers['cache-control'] == 'private, no-store'


@pytest.mark.parametrize('flag', [False, True])
def test_missing_and_inaccessible_scene_have_same_rest_404(client, gm, world, monkeypatch, flag):
    monkeypatch.setattr(config, 'EXPERIMENTAL_VISIBILITY', flag)
    missing = client.get(f'/api/scenes/{uuid.uuid4()}', headers=gm)
    hidden = client.get(f'/api/scenes/{world.inactive}', headers=world.headers[0])
    assert missing.status_code == hidden.status_code == 404
    assert missing.json() == hidden.json() == {'detail': 'scene not found'}


def test_initial_success_keeps_order_and_releases_reads_before_transport(client, world, monkeypatch):
    original = main.hub.send
    sent = []

    async def transport(ws, message):
        if message['type'] in ('snapshot', 'campaign'):
            # A separate writer can commit at the actual send boundary.
            async with SessionLocal() as db:
                scene = await db.get(Scene, world.scene)
                scene.name = 'PB02 writable at ' + message['type']
                await db.commit()
            sent.append(message['type'])
        await original(ws, message)

    monkeypatch.setattr(main.hub, 'send', transport)
    with client.websocket_connect(f'/ws/scene/{world.scene}', headers=world.headers[0]) as ws:
        assert ws.receive_json()['type'] == 'snapshot'
        assert ws.receive_json()['type'] == 'campaign'
        recv_until(ws, lambda message: message['type'] == 'presence')
        assert sent == ['snapshot', 'campaign']
