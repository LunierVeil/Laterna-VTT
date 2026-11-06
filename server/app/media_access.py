"""PB-02 experimental uploads ACL using existing references, no new storage schema.

An upload URL is never a permission. Only current session + current authorized
references grant access. Pending unlinked uploads get a short session-bound grant
for existing editor previews; attachment references take precedence over grants.
"""
from __future__ import annotations

import asyncio
import anyio
from collections import OrderedDict
import json
import re
from time import monotonic

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException
from starlette.staticfiles import StaticFiles

from . import auth, config
from .models import Character, Scene, Token
from .recipient_projection import projection_session, read_snapshot, recipient, scene_token_visible

# Conservative experimental limits; NOT production performance/SLA or asset limits.
MAX_MATCHES = 256
MAX_JSON_BYTES = 1_000_000
ACL_SECONDS = 1.
PENDING_TTL = 600.
PENDING_LIMIT = 256
UPLOAD_NAME = re.compile(r'[0-9a-f]{32}\.(?:png|jpg|webp)')
_pending = OrderedDict()
PRIVATE_HEADERS = {'Cache-Control': 'private, no-store', 'Vary': 'Cookie'}


def remember_upload(name: str, actor, campaign_id: str) -> None:
    if not config.EXPERIMENTAL_VISIBILITY:
        return
    _pending[name] = (actor.id, actor.session, campaign_id, monotonic() + PENDING_TTL)
    while len(_pending) > PENDING_LIMIT:
        _pending.popitem(last=False)


def pending_allowed(name, actor, campaign_id):
    grant = _pending.get(name)
    if grant is None:
        return False
    if grant[3] <= monotonic():
        _pending.pop(name, None)
        return False
    return grant[:3] == (actor.id, actor.session, campaign_id)


def _character_references(raw: str, url: str):
    """Bounded JSON scan off the event loop; only actual string references count."""
    if len(raw.encode('utf-8')) > MAX_JSON_BYTES:
        raise ValueError('experimental media JSON budget')
    data = json.loads(raw)
    stack = [data]
    found = False
    while stack:
        value = stack.pop()
        if isinstance(value, str):
            found = found or value == url
        elif isinstance(value, dict):
            stack.extend(value.values())
        elif isinstance(value, list):
            stack.extend(value)
    portrait = data.get('portrait') if isinstance(data, dict) else None
    return found, portrait == url


def _upload_references(value):
    names, stack = set(), [value]
    while stack:
        item = stack.pop()
        if isinstance(item, str) and item.startswith('/uploads/'):
            name = item.removeprefix('/uploads/')
            if UPLOAD_NAME.fullmatch(name):
                names.add(name)
        elif isinstance(item, dict):
            stack.extend(item.values())
        elif isinstance(item, list):
            stack.extend(item)
    return names


async def attachment_allowed(actor, event_name: str, payload: dict) -> bool:
    """A new reference cannot manufacture a read grant to somebody else's file.

    Inspect canonical handler output (including parsed imports/document edits),
    not raw client JSON. A separate read transaction sees committed references,
    never the handler's uncommitted proposed attachment. The caller rolls back
    the command on denial, before advancing seq or publishing anything.
    """
    if not config.EXPERIMENTAL_VISIBILITY:
        return True
    with anyio.CancelScope(shield=True):
        return await _attachment_allowed(actor, event_name, payload)


async def _attachment_allowed(actor, event_name: str, payload: dict) -> bool:
    if event_name in ('character.created', 'character.saved'):
        value = payload['character']['data']
    elif event_name in ('token.added', 'token.updated'):
        value = payload['token'].get('image_url')
    elif event_name == 'scene.updated':
        value = payload.get('background_url')
    else:
        return True
    names = _upload_references(value)
    if not names:
        return True
    if len(names) > MAX_MATCHES:
        return False
    try:
        async with asyncio.timeout(ACL_SECONDS):
            async with projection_session() as db:
                await read_snapshot(db)
                subject = await recipient(db, actor.session)
                if subject is None or (subject[0].id, subject[0].is_gm) != (actor.id, actor.is_gm):
                    return False
                # An unchanged reference is not a new sharing decision. Check
                # the committed target, never the writer's flushed ORM object.
                if event_name.startswith('character.'):
                    target = await db.get(Character, payload['character']['id'])
                    previous = _upload_references(json.loads(target.data_json)) if target else set()
                elif event_name.startswith('token.'):
                    target = await db.get(Token, payload['token']['id'])
                    previous = _upload_references(target.image_url) if target else set()
                else:
                    previous = set()
                for name in sorted(names):
                    if name not in previous and not await allowed_upload(db, name, actor.session):
                        return False
        return True
    except (TimeoutError, ValueError, TypeError, RecursionError, SQLAlchemyError):
        return False


async def allowed_upload(db, name: str, session_hash: str) -> bool:
    # ASGI disconnect must not abandon SQLite while it holds a read transaction.
    # The outer explicit ACL deadline still fails closed (asyncio cancellation).
    with anyio.CancelScope(shield=True):
        return await _allowed_upload(db, name, session_hash)


async def _allowed_upload(db, name: str, session_hash: str) -> bool:
    await read_snapshot(db)
    subject = await recipient(db, session_hash)
    if subject is None:
        return False
    actor, campaign_id, active_id = subject
    url = '/uploads/' + name
    referenced, allowed = False, False
    visibility = {}
    # All references are checked before returning a positive answer. Unknown or
    # over-budget scans fail closed; do not return on the first matching grant.
    scenes = (await db.scalars(select(Scene).where(Scene.background_url == url).limit(MAX_MATCHES + 1))).all()
    if len(scenes) > MAX_MATCHES:
        return False
    for scene in scenes:
        referenced = True
        allowed |= scene.campaign_id == campaign_id and (actor.is_gm or scene.id == active_id)
    tokens = (await db.execute(select(Token, Scene).join(Scene, Scene.id == Token.scene_id)
              .where(Token.image_url == url).limit(MAX_MATCHES + 1))).all()
    if len(tokens) > MAX_MATCHES:
        return False
    for token, scene in tokens:
        referenced = True
        if scene.campaign_id == campaign_id and (actor.is_gm or scene.id == active_id):
            allowed |= await scene_token_visible(db, actor, token, json.loads(scene.fog_json or '[]'), cache=visibility)
    # Canonical uploaded filename contains no SQL wildcard; allow escaped JSON
    # path slashes by querying its filename then checking parsed string equality.
    characters = (await db.scalars(select(Character).where(Character.data_json.contains(name)).limit(MAX_MATCHES + 1))).all()
    if len(characters) > MAX_MATCHES:
        return False
    for character in characters:
        found, portrait = await run_in_threadpool(_character_references, character.data_json or '{}', url)
        if not found:
            continue
        referenced = True
        if character.campaign_id != campaign_id:
            continue
        if actor.is_gm or character.owner_id == actor.id:
            allowed = True
        elif portrait:
            linked = (await db.execute(select(Token, Scene).join(Scene, Scene.id == Token.scene_id)
                      .where(Token.character_id == character.id, Scene.campaign_id == campaign_id,
                             Scene.id == active_id).limit(MAX_MATCHES + 1))).all()
            if len(linked) > MAX_MATCHES:
                return False
            for token, scene in linked:
                allowed |= await scene_token_visible(db, actor, token, json.loads(scene.fog_json or '[]'), cache=visibility)
    return bool(allowed) if referenced else pending_allowed(name, actor, campaign_id)


class RecipientUploads(StaticFiles):
    async def get_response(self, path, scope):
        if not config.EXPERIMENTAL_VISIBILITY:
            return await super().get_response(path, scope)
        if not UPLOAD_NAME.fullmatch(path):
            raise HTTPException(404, headers=PRIVATE_HEADERS)
        request = Request(scope)
        token = request.cookies.get(auth.SESSION_COOKIE)
        if not token:
            raise HTTPException(404, headers=PRIVATE_HEADERS)
        try:
            async with asyncio.timeout(ACL_SECONDS):
                async with projection_session() as db:
                    allowed = await allowed_upload(db, path, auth.session_id(token))
            if not allowed:
                raise HTTPException(404, headers=PRIVATE_HEADERS)
        except (TimeoutError, ValueError, TypeError, RecursionError, SQLAlchemyError):
            raise HTTPException(404, headers=PRIVATE_HEADERS) from None
        response = await super().get_response(path, scope)
        response.headers['Cache-Control'] = 'private, no-store'
        response.headers['Vary'] = 'Cookie'
        return response
