"""Characterization of the current session and campaign lookup contracts."""

import asyncio
import hashlib
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from http.cookies import SimpleCookie

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import NoResultFound
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from starlette.websockets import WebSocketDisconnect

from app import auth, config, db as persistence, main, recipient_projection
from app.db import Base
from app.models import AuthSession, Campaign, Scene, User
from app.recipient_projection import recipient


@asynccontextmanager
async def sqlite_sessions():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        yield async_sessionmaker(engine, expire_on_commit=False)
    finally:
        await engine.dispose()


def test_legacy_session_hash_expiry_and_transaction_ownership():
    async def check():
        async with sqlite_sessions() as sessions, sessions() as db:
            campaign = Campaign(name="Session test")
            db.add(campaign)
            await db.flush()
            user = User(campaign_id=campaign.id, name="Player", password_hash="unused")
            db.add(user)
            await db.flush()

            raw = await auth.create_session(db, user)
            digest = hashlib.sha256(raw.encode()).hexdigest()
            assert auth.session_id(raw) == digest
            assert await db.get(AuthSession, raw) is None
            row = await db.get(AuthSession, digest)
            assert row.user_id == user.id
            assert auth.actor_of(user, raw).session == digest
            assert auth.actor_of(user).session == ""
            await db.commit()

            assert await auth.session_user(db, raw) is user
            await auth.drop_session(db, raw)
            await db.flush()
            await db.rollback()
            assert await auth.session_user(db, raw) is user

            row = await db.get(AuthSession, digest)
            row.created_at = datetime.now(timezone.utc) - timedelta(days=31)
            await db.commit()
            # The experimental read denies expiry without deleting the row.
            assert await recipient(db, digest) is None
            assert await db.get(AuthSession, digest) is not None
            # The legacy read commits deletion even if the caller rolls back.
            assert await auth.session_user(db, raw) is None
            await db.rollback()
            assert await db.get(AuthSession, digest) is None

    asyncio.run(check())


def test_campaign_lookup_and_recipient_tie_break(monkeypatch):
    async def check():
        async with sqlite_sessions() as sessions, sessions() as db:
            monkeypatch.setattr(config, "EXPERIMENTAL_VISIBILITY", True)
            with pytest.raises(NoResultFound):
                await main.get_campaign(db)

            older = datetime(2020, 1, 1, tzinfo=timezone.utc)
            primary = Campaign(id="b", name="Primary", created_at=older)
            tied = Campaign(id="c", name="Tied", created_at=older)
            newer = Campaign(id="a", name="Newer", created_at=older + timedelta(days=1))
            db.add_all([tied, newer, primary])
            await db.flush()
            primary_user = User(campaign_id=primary.id, name="Same Name", password_hash="unused")
            foreign_gm = User(campaign_id=tied.id, name="Same Name", password_hash="unused", is_gm=True)
            db.add_all([foreign_gm, primary_user])
            await db.flush()
            primary_raw = await auth.create_session(db, primary_user)
            foreign_raw = await auth.create_session(db, foreign_gm)
            await db.commit()

            assert (await main.get_campaign(db)).id == primary.id
            assert (await auth.find_user(db, primary, "Same Name")).id == primary_user.id
            assert (await auth.find_user(db, tied, "Same Name")).id == foreign_gm.id
            assert await auth.find_user(db, primary, "same name") is None
            assert await auth.find_user(db, newer, "Same Name") is None
            subject = await recipient(db, auth.session_id(primary_raw))
            assert subject is not None
            actor, campaign_id, active_id = subject
            assert (actor.id, actor.is_gm, campaign_id, active_id) == (primary_user.id, False, primary.id, None)
            assert await recipient(db, auth.session_id(foreign_raw)) is None

    asyncio.run(check())


@pytest.mark.parametrize("experimental", [False, True], ids=["legacy", "experimental"])
def test_cookie_logout_and_websocket_reconnect(monkeypatch, experimental):
    monkeypatch.setattr(config, "EXPERIMENTAL_VISIBILITY", experimental)
    credentials = {"name": "Session boundary GM", "password": "test-password"}

    @asynccontextmanager
    async def lifespan(_app):
        async with sqlite_sessions() as sessions:
            # Isolate this test even when pytest shares a worker with other files.
            monkeypatch.setattr(persistence, "SessionLocal", sessions)
            monkeypatch.setattr(recipient_projection, "SessionLocal", sessions)
            async with sessions() as db:
                campaign = Campaign(name="Session test")
                db.add(campaign)
                await db.flush()
                scene = Scene(campaign_id=campaign.id, name="Table")
                db.add(scene)
                await db.flush()
                campaign.active_scene_id = scene.id
                await auth.create_user(db, campaign, **credentials, is_gm=True)
                await db.commit()
            yield

    monkeypatch.setattr(main.app.router, "lifespan_context", lifespan)
    with TestClient(main.app) as client:
        first = client.post("/api/login", json=credentials)
        second = client.post("/api/login", json=credentials)
        client.cookies.clear()
        assert first.status_code == second.status_code == 200
        identity = {field: first.json()[field] for field in ("id", "name", "is_gm")}
        assert identity["is_gm"] is True

        cookie = SimpleCookie(first.headers["set-cookie"])["lanterna_session"]
        assert cookie["httponly"] and not cookie["secure"]
        assert cookie["samesite"].lower() == "lax"
        assert cookie["path"] == "/" and cookie["max-age"] == "2592000"
        alternate = second.cookies["lanterna_session"]
        assert cookie.value != alternate
        first_headers = {"cookie": f"lanterna_session={cookie.value}"}
        second_headers = {"cookie": f"lanterna_session={alternate}"}

        assert client.get("/api/me", headers=first_headers).json() == identity
        campaign = client.get("/api/campaign", headers=first_headers)
        assert campaign.status_code == 200
        path = f"/ws/scene/{campaign.json()['active_scene_id']}"

        with client.websocket_connect(path, headers=first_headers) as ws:
            before = ws.receive_json()
            assert before["type"] == "snapshot"
            assert ws.receive_json()["type"] == "campaign"
            # Presence follows join, so this connection is registered for kick.
            assert ws.receive_json()["type"] == "presence"
            logout = client.post("/api/logout", headers=first_headers)
            assert logout.status_code == 200 and logout.json() == {"ok": True}
            cleared = SimpleCookie(logout.headers["set-cookie"])["lanterna_session"]
            assert cleared.value == "" and cleared["max-age"] == "0" and cleared["path"] == "/"
            assert ws.receive_json() == {"type": "auth_required"}
            with pytest.raises(WebSocketDisconnect) as closed:
                ws.receive_json()
            assert closed.value.code == 4401

        me = client.get("/api/me", headers=first_headers)
        assert me.status_code == 200 and me.json() is None
        denied = client.get("/api/campaign", headers=first_headers)
        assert denied.status_code == 401 and denied.json() == {"detail": "нужно войти"}
        assert client.get("/api/me", headers=second_headers).json() == identity
        with client.websocket_connect(path, headers=first_headers) as ws:
            assert ws.receive_json() == {"type": "auth_required"}
            with pytest.raises(WebSocketDisconnect) as closed:
                ws.receive_json()
            assert closed.value.code == 4401
        with client.websocket_connect(path, headers=second_headers) as ws:
            after = ws.receive_json()
            assert after["type"] == "snapshot" and after["seq"] == before["seq"]
            assert after["you"] == before["you"]
            assert ws.receive_json()["type"] == "campaign"
