"""PB-01d-3 experimental immutable input/context; no DB or runtime adapter.

A content version describes the supplied capture, NOT its truth or freshness.
The producer must supply a coherent capture; SQLite evidence lives in tests.
"""
from __future__ import annotations

import asyncio
from collections.abc import Callable
from dataclasses import dataclass
import hashlib
import json

from .lighting import Ambient, LightSource, LightingField, SourceState
from .line_of_sight import INITIAL_EPSILON_PX, Point, PreparedGeometry, Segment


@dataclass(frozen=True, slots=True)
class SourceInput:
    position: Point
    radius: float


@dataclass(frozen=True, slots=True)
class ContextInput:
    scope_key: str
    state_revision: str  # producer-owned capture revision; NOT implicitly Scene.seq
    width: float
    height: float
    segments: tuple[Segment, ...]
    sources: tuple[SourceInput, ...]
    ambient: Ambient
    epsilon: float = INITIAL_EPSILON_PX


@dataclass(frozen=True, slots=True)
class ContextVersion:
    scope_key: str
    state_revision: str
    content_digest: str


@dataclass(frozen=True, slots=True)
class ComputationContext:
    version: ContextVersion
    geometry: PreparedGeometry
    lighting: LightingField


def _immutable_point(point):
    if type(point) is not tuple or len(point) != 2:
        raise ValueError("capture positions must be immutable pairs")
    if any(type(v) not in (int, float) for v in point):
        raise ValueError("capture coordinates must be native immutable numbers")


def build_context(data: ContextInput, *, checkpoint: Callable[[], None] = lambda: None) -> ComputationContext:
    """Synchronous worker core. Never invoke heavy preparation in an event loop.

    Accept only deeply immutable tuple captures, not caller-owned mutable lists.
    A checkpoint can abort between records/atomic kernel calls. This function
    alone does not impose resource budgets: use the experimental runner.
    """
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        pass
    else:
        raise RuntimeError("build_context must execute outside the asyncio event loop")
    checkpoint()
    if type(data) is not ContextInput:
        raise TypeError("expected ContextInput")
    if not isinstance(data.scope_key, str) or not data.scope_key or not isinstance(data.state_revision, str) or not data.state_revision:
        raise ValueError("scope and producer revision must be explicit nonempty strings")
    if type(data.segments) is not tuple or type(data.sources) is not tuple:
        raise ValueError("capture collections must be immutable tuples")

    def segments():
        for segment in data.segments:
            checkpoint()
            if type(segment) is not tuple or len(segment) != 2:
                raise ValueError("capture segments must be immutable pairs")
            for point in segment:
                _immutable_point(point)
            yield segment
    geometry = PreparedGeometry(segments(), width=data.width, height=data.height, epsilon=data.epsilon)
    checkpoint()
    sources = []
    for source in data.sources:
        checkpoint()
        if type(source) is not SourceInput or type(source.radius) not in (int, float):
            raise ValueError("expected immutable source inputs")
        _immutable_point(source.position)
        prepared = LightSource(geometry, source.position, source.radius)
        checkpoint()
        if prepared.state is not SourceState.READY:
            raise ValueError("source on obstacle: context unavailable")
        sources.append(prepared)
    lighting = LightingField(geometry, sources, ambient=data.ambient)
    digest = hashlib.sha256()
    def record(value):
        checkpoint()
        digest.update(json.dumps(value, separators=(',', ':'), ensure_ascii=True).encode('ascii') + b'\n')
    record([data.scope_key, data.state_revision, geometry.width.hex(), geometry.height.hex(),
            geometry.epsilon.hex(), lighting.ambient.value, len(data.segments), len(sources)])
    # Include every validated raw segment (including zeros and ordering). This is
    # conservative versioning, not a geometry-equivalence canonicalization.
    for segment in data.segments:
        record([[float(v).hex() for v in point] for point in segment])
    for source in sources:
        record([[v.hex() for v in source.position], source.radius.hex()])
    checkpoint()
    return ComputationContext(ContextVersion(data.scope_key, data.state_revision, digest.hexdigest()), geometry, lighting)
