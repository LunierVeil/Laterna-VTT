"""Bounded exact LOS policy; immutable DB capture, no transport or authorization.

The recipient boundary must validate session/scope and stamp before publication.
Unsupported/missing observers yield own-only, never a positive visibility lease.
"""
from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
import hashlib
import json
import threading
from types import SimpleNamespace

from sqlalchemy import select

from . import fog
from .line_of_sight import SightState
from .models import Character, Scene, Token, Wall
from .scene_sight import prepare_scene_geometry

MAX_TOKENS = 32
MAX_WALLS = 200
MAX_BYTES = 1_000_000
CPU_SECONDS = .5
_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix='laterna-los')
_capacity = threading.BoundedSemaphore(1)


class Witnessed(dict):
    """Internal provenance, NOT a DTO field; json serializes dictionary keys only."""
    def __init__(self, data, stamp):
        super().__init__(data)
        self.los_stamp = stamp


@dataclass(frozen=True, slots=True)
class Target:
    id: str
    x: float
    y: float
    layer: str
    owner_id: str | None
    character_id: str | None
    system: str | None
    character_owner: str | None


@dataclass(frozen=True, slots=True)
class Obstacle:
    scene_id: str
    x1: float
    y1: float
    x2: float
    y2: float
    kind: str
    door_state: str | None
    blocks_sight: bool


@dataclass(frozen=True, slots=True)
class Capture:
    id: str
    campaign_id: str
    width: int
    height: int
    seq: int
    fog_json: str
    tokens: tuple[Target, ...]
    walls: tuple[Obstacle, ...]
    stamp: str
    over_budget: bool


@dataclass(frozen=True, slots=True)
class Visibility:
    ids: frozenset[str]
    status: str
    destination: bool = False


async def capture_scene(db, scene_id: str, actor_id: str) -> Capture | None:
    """Caller owns a physical read transaction; no live ORM values cross threads."""
    scene = (await db.execute(select(Scene.__table__).where(Scene.id == scene_id))).mappings().first()
    if scene is None:
        return None
    tokens = (await db.execute(select(Token.__table__).where(Token.scene_id == scene_id)
              .order_by((Token.owner_id == actor_id).desc(), Token.id).limit(MAX_TOKENS + 1))).mappings().all()
    walls = (await db.execute(select(Wall.__table__).where(Wall.scene_id == scene_id)
             .order_by(Wall.id).limit(MAX_WALLS + 1))).mappings().all()
    chars = (await db.execute(select(Character.__table__).where(Character.id.in_(
        [t['character_id'] for t in tokens if t['character_id']])).order_by(Character.id))).mappings().all()
    raw = json.dumps([dict(scene), [dict(t) for t in tokens], [dict(w) for w in walls],
                      [dict(c) for c in chars]], sort_keys=True, default=str).encode()
    characters = {c['id']: c for c in chars if c['campaign_id'] == scene['campaign_id']}
    return Capture(scene_id, scene['campaign_id'], scene['width'], scene['height'], scene['seq'],
        scene['fog_json'] or '[]', tuple(Target(t['id'], t['x'], t['y'], t['layer'], t['owner_id'],
        t['character_id'], characters.get(t['character_id'], {}).get('system'),
        characters.get(t['character_id'], {}).get('owner_id')) for t in tokens),
        tuple(Obstacle(w['scene_id'], w['x1'], w['y1'], w['x2'], w['y2'], w['kind'],
                       w['door_state'], w['blocks_sight']) for w in walls),
        hashlib.sha256(raw).hexdigest(), len(raw) > MAX_BYTES or len(tokens) > MAX_TOKENS or len(walls) > MAX_WALLS)


def own_only(frame: Capture, actor, status: str) -> Visibility:
    return Visibility(frozenset(t.id for t in frame.tokens if t.owner_id == actor.id and t.layer != 'gm'), status)


def calculate(frame: Capture, actor, destination=None) -> Visibility:
    own = own_only(frame, actor, 'unavailable')
    if frame.over_budget:
        return own_only(frame, actor, 'budget')
    observers = [t for t in frame.tokens if t.owner_id == actor.id and t.layer != 'gm'
                 and t.system == 'dnd5e' and t.character_owner == actor.id]
    if len(observers) != 1:
        return own_only(frame, actor, 'observer_unavailable')
    try:
        geometry = prepare_scene_geometry(SimpleNamespace(id=frame.id, width=frame.width, height=frame.height), frame.walls)
        observer = (observers[0].x, observers[0].y)
        if geometry.point_sight(observer, observer).state is not SightState.CLEAR:
            return own_only(frame, actor, 'observer_on_obstacle')
        regions = json.loads(frame.fog_json)
        allowed = set(own.ids)
        for token in frame.tokens:
            if token.id in allowed or token.layer == 'gm' or fog.contains_point(regions, token.x, token.y):
                continue
            if geometry.point_sight(observer, (token.x, token.y)).state is SightState.CLEAR:
                allowed.add(token.id)
        visible_destination = False
        if destination:
            token_id, x, y = destination
            visible_destination = token_id in own.ids or (token_id in allowed and
                not fog.contains_point(regions, x, y) and geometry.point_sight(observer, (x, y)).state is SightState.CLEAR)
        return Visibility(frozenset(allowed), 'complete', visible_destination)
    except Exception:
        # Invalid/unsupported geometry is unavailable. Never skip a bad wall.
        return own


async def calculate_bounded(frame: Capture, actor, destination=None) -> Visibility:
    if not _capacity.acquire(blocking=False):
        return own_only(frame, actor, 'busy')

    def work():
        try:
            return calculate(frame, actor, destination)
        finally:
            _capacity.release()

    try:
        future = _executor.submit(work)
    except BaseException:
        _capacity.release()
        raise
    try:
        async with asyncio.timeout(CPU_SECONDS):
            return await asyncio.shield(asyncio.wrap_future(future))
    except TimeoutError:
        return own_only(frame, actor, 'timeout')
