"""Internal committed-scene LOS. No routes, commands, ACL or player projection.

Every call opens a fresh read session and obtains Scene + Wall in one SELECT.
There is deliberately no global geometry cache or handler invalidation hook.
A batch uses one point-in-time snapshot; it is not a live authorization lease.
"""
from __future__ import annotations

from typing import Iterable
from math import isfinite

from sqlalchemy import select
from sqlalchemy.orm import Load

from .db import SessionLocal
from .line_of_sight import INITIAL_EPSILON_PX, Point, PreparedGeometry, SightResult
from .models import Scene, Wall


class SceneGeometryUnavailable(ValueError):
    """Missing scene or unsupported/ambiguous input: never interpret as CLEAR."""


def prepare_scene_geometry(scene: Scene, walls: Iterable[Wall], *,
                           epsilon: float = INITIAL_EPSILON_PX) -> PreparedGeometry:
    """Copy already loaded models. The caller owns the snapshot's lifetime.

    Ordinary door state overrides flags. W3 windows use blocks_sight independently
    of movement. Unknown kinds fail explicitly, even if blocks_sight=false.
    Neither this adapter nor CLEAR grants access to any scene or object.
    """
    segments = []
    for wall in walls:
        if wall.scene_id != scene.id:
            raise SceneGeometryUnavailable("wall does not belong to scene")
        # Validate transparent obstacles too: bad protected input is not CLEAR.
        for value, limit in ((wall.x1, scene.width), (wall.x2, scene.width),
                             (wall.y1, scene.height), (wall.y2, scene.height)):
            try:
                valid = (not isinstance(value, bool) and isinstance(value, (int, float))
                         and isfinite(value) and 0 <= value <= limit)
            except (OverflowError, ValueError):
                valid = False
            if not valid:
                raise SceneGeometryUnavailable("invalid wall coordinates")
        if wall.kind in ("wall", "window"):
            if not isinstance(wall.blocks_sight, bool):
                raise SceneGeometryUnavailable("ambiguous wall sight flag")
            opaque = wall.blocks_sight
        elif wall.kind == "door":
            if wall.door_state not in ("open", "closed", "locked"):
                raise SceneGeometryUnavailable("unsupported door state")
            opaque = wall.door_state != "open"
        else:
            raise SceneGeometryUnavailable("unsupported wall kind")
        if opaque:
            segments.append(((wall.x1, wall.y1), (wall.x2, wall.y2)))
    return PreparedGeometry(segments, width=scene.width, height=scene.height, epsilon=epsilon)


async def scene_sights(scene_id: str, rays: Iterable[tuple[Point, Point]], *,
                       epsilon: float = INITIAL_EPSILON_PX) -> tuple[SightResult, ...]:
    """Fresh committed geometry per call, reused only inside this explicit batch.

    A call starting after a successful door commit sees that committed state.
    Concurrent later commits do not rewrite a batch already captured by SELECT.
    No existing request session/ORM identity map or client snapshot is reused.
    Separate processes sharing the DB read independently; no in-memory cache
    coherence is assumed. Do not use this as an object-disclosure API.
    """
    async with SessionLocal() as db:
        rows = (await db.execute(
            select(Scene, Wall).options(
                Load(Scene).load_only(Scene.id, Scene.width, Scene.height),
                Load(Wall).load_only(Wall.id, Wall.scene_id, Wall.x1, Wall.y1,
                                     Wall.x2, Wall.y2, Wall.kind, Wall.door_state,
                                     Wall.blocks_sight),
            ).outerjoin(Wall, Wall.scene_id == Scene.id)
            .where(Scene.id == scene_id)
        )).all()
        if not rows:
            raise SceneGeometryUnavailable("scene unavailable")
        geometry = prepare_scene_geometry(rows[0][0],
                                          (wall for _, wall in rows if wall is not None),
                                          epsilon=epsilon)
    return tuple(geometry.point_sight(observer, target) for observer, target in rays)


async def scene_sight(scene_id: str, observer: Point, target: Point, *,
                      epsilon: float = INITIAL_EPSILON_PX) -> SightResult:
    """One fresh internal query. CLEAR is a geometric fact, not permission."""
    return (await scene_sights(scene_id, ((observer, target),), epsilon=epsilon))[0]
