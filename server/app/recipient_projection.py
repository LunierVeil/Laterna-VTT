"""PB-02: shared recipient rules for the existing GM layer/manual FoW.

No LOS policy yet. Dynamic sight plugs into the next functional slice; CLEAR
alone will never replace actor/campaign/ownership checks.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from contextlib import asynccontextmanager

import anyio
import json

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from . import auth, fog
from .models import AuthSession, Campaign, Scene, Token, User, Wall
from .roles import Actor
from .db import SessionLocal


@asynccontextmanager
async def projection_session():
    """Own read session; release SQLite read locks even on ASGI cancellation.

    AnyIO level cancellation can interrupt SQLAlchemy's asyncio-shielded close.
    Keep cleanup shielded from the request cancel scope, not the calculation.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        with anyio.CancelScope(shield=True):
            await db.close()


def visible_state(actor: Actor, *, gm_layer: bool, owner_id: str | None, obscured: bool) -> bool:
    return actor.is_gm or (not gm_layer and (owner_id == actor.id or not obscured))


def token_visible(actor: Actor, token, regions: list[dict], *, destination=None) -> bool:
    if actor.is_gm:
        return True
    obscured = fog.contains_point(regions, token.x, token.y)
    if destination is not None:
        obscured = obscured or fog.contains_point(regions, *destination)
    return visible_state(actor, gm_layer=token.layer == 'gm', owner_id=token.owner_id, obscured=obscured)


async def recipient(db: AsyncSession, session_hash: str, *, scene_id: str | None = None):
    """Fresh session/user/campaign authorization in ONE SELECT, no client roles.

    Experimental deployment keeps the existing single active campaign. A session
    belonging to a different campaign is denied, not treated as the host GM.
    """
    # A disconnected socket can cancel presence/freshness checks too, not only
    # full snapshots. Let SQLite finalize this short SELECT before cancellation;
    # an abandoned cursor may retain a read lock even after connection invalidation.
    with anyio.CancelScope(shield=True):
        return await _recipient(db, session_hash, scene_id=scene_id)


async def _recipient(db: AsyncSession, session_hash: str, *, scene_id: str | None = None):
    if not session_hash:
        return None
    primary = (select(Campaign.id).order_by(Campaign.created_at, Campaign.id)
               .limit(1).correlate(None).scalar_subquery())
    # Scalar columns deliberately bypass SQLAlchemy's identity map: an earlier
    # request check must not mask a committed role/session/campaign change.
    query = (select(AuthSession.created_at, User.id, User.name, User.is_gm,
                    Campaign.id, Campaign.active_scene_id).select_from(AuthSession)
             .join(User, User.id == AuthSession.user_id)
             .join(Campaign, Campaign.id == User.campaign_id)
             .where(AuthSession.token_hash == session_hash, Campaign.id == primary))
    if scene_id is not None:
        query = query.join(Scene, Scene.campaign_id == Campaign.id).where(
            Scene.id == scene_id, (User.is_gm | (Scene.id == Campaign.active_scene_id)))
    row = (await db.execute(query)).first()
    if row is None:
        return None
    created, user_id, name, is_gm, campaign_id, active_id = row
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    if datetime.now(timezone.utc) - created > timedelta(seconds=auth.SESSION_MAX_AGE):
        return None
    return Actor(user_id, name, bool(is_gm), session_hash), campaign_id, active_id


async def command_target_visible(db, scene, actor, name, payload):
    """Known IDs are not permissions to mutate a hidden object.

    Existing owner/GM command checks still run afterwards. No movement/rules
    changes; this is the recipient predicate on the same target before writes.
    """
    with anyio.CancelScope(shield=True):
        return await _command_target_visible(db, scene, actor, name, payload)


async def _command_target_visible(db, scene, actor, name, payload):
    if actor.is_gm:
        return True
    regions = json.loads(scene.fog_json or '[]')
    token_id = None
    if name in ('token.move', 'token.update', 'token.remove'):
        token_id = payload.get('id')
    elif name == 'combat.add':
        token_id = payload.get('token_id')
    elif name in ('combat.set', 'combat.roll', 'combat.remove'):
        combat = json.loads(scene.combat_json or '{}')
        entry = next((e for e in combat.get('entries', []) if e['id'] == payload.get('entry_id')), None)
        if entry is None:
            return False
        token_id = entry.get('token_id')
    elif name in ('wall.door', 'wall.remove'):
        wall = await db.get(Wall, payload.get('id')) if isinstance(payload.get('id'), str) else None
        return wall is not None and wall.scene_id == scene.id and not fog.covers_segment(regions, wall.x1, wall.y1, wall.x2, wall.y2)
    else:
        return True
    token = await db.get(Token, token_id) if isinstance(token_id, str) else None
    return token is not None and token.scene_id == scene.id and token_visible(actor, token, regions)


async def read_snapshot(db: AsyncSession) -> None:
    """SQLite legacy SELECT needs a physical read transaction, not just Session.begin.

    Only used in readonly projection paths. No engine-wide PRAGMA/schema change.
    """
    if db.bind.dialect.name == 'sqlite':
        connection = await db.connection()
        raw = await connection.get_raw_connection()
        if not raw.driver_connection.in_transaction:
            from sqlalchemy import text
            await db.execute(text('BEGIN'))
