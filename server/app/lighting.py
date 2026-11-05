"""PB-01d-2: isolated binary point lighting, not rendering or permission.

Only exact PreparedGeometry point LOS is used. No approximate polygon, source
persistence/token binding, D&D vision, ambient default, FoW or network consumer.
"""
from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field
from enum import Enum
from fractions import Fraction
from math import isfinite

from .line_of_sight import Point, PreparedGeometry, SightResult, SightState


class SourceState(str, Enum):
    READY = "ready"
    ON_OBSTACLE = "source_on_obstacle"


class LightState(str, Enum):
    LIT = "lit"
    UNLIT = "unlit"
    UNAVAILABLE = "unavailable"


@dataclass(frozen=True, slots=True)
class LightResult:
    state: LightState
    ignored_zero_length: int = 0


def _finite_number(value: object, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{name} must be a finite number (not bool)")
    try:
        value = float(value)
    except (OverflowError, ValueError) as exc:
        raise ValueError(f"{name} must be finite") from exc
    if not isfinite(value):
        raise ValueError(f"{name} must be finite")
    return value


def _position(value: object, geometry: PreparedGeometry) -> Point:
    # Lighting validates even queries that bypass LOS (ambient/radius). Keep the
    # native-number/bounds contract of point_sight without calling private helpers
    # or scanning all walls just to validate an out-of-radius query.
    if not isinstance(value, (tuple, list)) or len(value) != 2:
        raise ValueError("position must have exactly two elements")
    x, y = _finite_number(value[0], "x"), _finite_number(value[1], "y")
    if not (0 <= x <= geometry.width and 0 <= y <= geometry.height):
        raise ValueError("position outside scene bounds")
    return x, y


@dataclass(frozen=True, slots=True, init=False)
class LightSource:
    """Immutable source bound to ONE exact geometry snapshot.

    Malformed position/radius raises ValueError. Source-on-obstacle is a
    diagnostic state, producing UNAVAILABLE for every point, never a moved or
    silently omitted source. State is readiness, not an on/off gameplay setting.
    """
    position: Point
    radius: float
    state: SourceState
    _geometry: PreparedGeometry = field(repr=False)
    _exact_position: tuple[Fraction, Fraction] = field(repr=False)
    _radius_squared: Fraction = field(repr=False)

    def __init__(self, geometry: PreparedGeometry, position: Point, radius: float):
        if not isinstance(geometry, PreparedGeometry):
            raise TypeError("expected exact PreparedGeometry")
        position = _position(position, geometry)
        radius = _finite_number(radius, "radius")
        if radius <= 0:
            raise ValueError("radius must be positive")
        check = geometry.point_sight(position, position)
        state = (SourceState.ON_OBSTACLE if check.state is SightState.OBSERVER_ON_OBSTACLE
                 else SourceState.READY)
        for name, value in (("position", position), ("radius", radius), ("state", state),
                            ("_geometry", geometry),
                            ("_exact_position", tuple(Fraction(v) for v in position)),
                            ("_radius_squared", Fraction(radius) ** 2)):
            object.__setattr__(self, name, value)

    def point_light(self, target: Point) -> LightResult:
        """Closed disk (distance <= radius), then exact LOS; no radius epsilon."""
        return self._point_light(_position(target, self._geometry))

    def _point_light(self, target: Point) -> LightResult:
        """Target already validated by this module's public query boundary."""
        ignored = self._geometry.ignored_zero_length
        if self.state is not SourceState.READY:
            return LightResult(LightState.UNAVAILABLE, ignored)
        distance_squared = sum((Fraction(v) - origin) ** 2
                               for v, origin in zip(target, self._exact_position))
        if distance_squared > self._radius_squared:
            return LightResult(LightState.UNLIT, ignored)
        sight = self._geometry.point_sight(self.position, target)
        if sight.state is SightState.CLEAR:
            return LightResult(LightState.LIT, ignored)
        if sight.state is SightState.BLOCKED:
            return LightResult(LightState.UNLIT, ignored)
        return LightResult(LightState.UNAVAILABLE, ignored)


class Ambient(str, Enum):
    NONE = "none"
    FULL = "full"


@dataclass(frozen=True, slots=True, init=False)
class LightingField:
    """Binary union in one snapshot, not a union of approximate polygons.

    All sources are checked before any positive result, including ambient FULL.
    Different geometry instances are rejected even if their walls happen to
    compare equal: this is a local binding invariant, NOT a freshness guarantee.
    """
    ambient: Ambient
    sources: tuple[LightSource, ...]
    unavailable_source_indices: tuple[int, ...]
    _geometry: PreparedGeometry = field(repr=False)

    def __init__(self, geometry: PreparedGeometry, sources: Iterable[LightSource], *, ambient: Ambient):
        if not isinstance(geometry, PreparedGeometry):
            raise TypeError("expected exact PreparedGeometry")
        try:
            ambient = Ambient(ambient)
        except (ValueError, TypeError) as exc:
            raise ValueError("ambient must explicitly be none or full") from exc
        sources = tuple(sources)  # eager: iterator failure cannot leave a partial field
        unavailable = []
        for index, source in enumerate(sources):
            if not isinstance(source, LightSource):
                raise TypeError("every source must be a LightSource")
            if source._geometry is not geometry:
                raise ValueError("all sources must use the same exact geometry instance")
            if source.state is not SourceState.READY:
                unavailable.append(index)
        for name, value in (("ambient", ambient), ("sources", sources),
                            ("unavailable_source_indices", tuple(unavailable)),
                            ("_geometry", geometry)):
            object.__setattr__(self, name, value)

    def point_light(self, target: Point) -> LightResult:
        """L only. Invalid sources take precedence over ambient or another lamp."""
        target = _position(target, self._geometry)
        ignored = self._geometry.ignored_zero_length
        if self.unavailable_source_indices:
            return LightResult(LightState.UNAVAILABLE, ignored)
        if self.ambient is Ambient.FULL:
            return LightResult(LightState.LIT, ignored)
        for source in self.sources:
            result = source._point_light(target)
            if result.state is not LightState.UNLIT:
                return result
        return LightResult(LightState.UNLIT, ignored)

    def point_sight(self, observer: Point, target: Point) -> SightResult:
        """G only: intentionally independent of light, game rules and permissions."""
        return self._geometry.point_sight(observer, target)
