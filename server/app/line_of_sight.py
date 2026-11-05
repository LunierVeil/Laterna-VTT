"""PB-01a: pure point-to-point sight calculation for prepared opaque segments.

No database, roles, scene projection, window/secret-door policy, lighting or FoW.
A CLEAR answer does NOT grant permission to disclose an object to a player.
Movement geometry has different epsilon units and must not be reused here.

See docs/PB01_VISIBILITY_RULES.md. Boundary behaviors and numerical tolerance
remain candidates for independent architectural review before integration.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from math import hypot, isfinite
from typing import Iterable, TypeAlias

Point: TypeAlias = tuple[float, float]
Segment: TypeAlias = tuple[Point, Point]
INITIAL_EPSILON_PX = 1e-7


class SightState(str, Enum):
    CLEAR = "clear"
    BLOCKED = "blocked"
    OBSERVER_ON_OBSTACLE = "observer_on_obstacle"


@dataclass(frozen=True, slots=True)
class SightResult:
    state: SightState
    ignored_zero_length: int = 0


def _number(value: object, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{name} must be a finite number (not bool)")
    try:
        number = float(value)
    except (OverflowError, ValueError) as exc:
        raise ValueError(f"{name} must be finite") from exc
    if not isfinite(number):
        raise ValueError(f"{name} must be finite")
    return number


def _pair(value: object, name: str) -> tuple[object, object]:
    if not isinstance(value, (tuple, list)) or len(value) != 2:
        raise ValueError(f"{name} must have exactly two elements")
    return value[0], value[1]


def _point(value: object, name: str, width: float, height: float) -> Point:
    raw_x, raw_y = _pair(value, name)
    x, y = _number(raw_x, f"{name}.x"), _number(raw_y, f"{name}.y")
    if not (0 <= x <= width and 0 <= y <= height):
        raise ValueError(f"{name} outside scene bounds")
    return x, y


def _distance_to_segment(p: Point, a: Point, b: Point) -> float:
    dx, dy = b[0] - a[0], b[1] - a[1]
    length = hypot(dx, dy)
    # Exactly zero segments are removed before this call.
    ux, uy = dx / length, dy / length
    t = max(0.0, min(length, (p[0] - a[0]) * ux + (p[1] - a[1]) * uy))
    return hypot(p[0] - (a[0] + t * ux), p[1] - (a[1] + t * uy))


def _signed_side(p: Point, a: Point, b: Point) -> float:
    dx, dy = b[0] - a[0], b[1] - a[1]
    length = hypot(dx, dy)
    # Linear units (px), not the squared-pixel units of a raw determinant.
    return (dx / length) * (p[1] - a[1]) - (dy / length) * (p[0] - a[0])


def _strict_interior_cross(a: Point, b: Point, c: Point, d: Point) -> bool:
    c_side, d_side = _signed_side(c, a, b), _signed_side(d, a, b)
    a_side, b_side = _signed_side(a, c, d), _signed_side(b, c, d)
    return ((c_side > 0 > d_side or c_side < 0 < d_side)
            and (a_side > 0 > b_side or a_side < 0 < b_side))


def _blocked_by(a: Point, b: Point, c: Point, d: Point, epsilon: float) -> bool:
    # Endpoint contact, collinear overlap, and near-misses within the
    # candidate linear tolerance; interior crossings need a separate check.
    return (_strict_interior_cross(a, b, c, d)
            or _distance_to_segment(a, c, d) <= epsilon
            or _distance_to_segment(b, c, d) <= epsilon
            or _distance_to_segment(c, a, b) <= epsilon
            or _distance_to_segment(d, a, b) <= epsilon)


def point_sight(
    observer: Point,
    target: Point,
    opaque_segments: Iterable[Segment],
    *,
    width: float,
    height: float,
    epsilon: float = INITIAL_EPSILON_PX,
) -> SightResult:
    """Classify a scene-pixel ray; no grid, camera or D&D rules are involved.

    Input must already be prepared opaque geometry, not an untrusted client's
    incomplete snapshot. The future server policy decides access independently.
    Invalid input raises ValueError rather than silently yielding CLEAR.
    All geometry is validated before visibility short-circuits.

    ignored_zero_length is a count without secret obstacle identities/locations.
    """
    width, height = _number(width, "width"), _number(height, "height")
    epsilon = _number(epsilon, "epsilon")
    if width <= 0 or height <= 0 or epsilon <= 0:
        raise ValueError("scene dimensions and epsilon must be positive")
    a = _point(observer, "observer", width, height)
    b = _point(target, "target", width, height)

    usable: list[Segment] = []
    ignored = 0
    try:
        iterator = iter(opaque_segments)
    except TypeError as exc:
        raise ValueError("opaque_segments must be iterable") from exc
    for index, raw in enumerate(iterator):
        raw_c, raw_d = _pair(raw, f"segment[{index}]")
        c = _point(raw_c, f"segment[{index}].a", width, height)
        d = _point(raw_d, f"segment[{index}].b", width, height)
        if c == d:
            ignored += 1
        else:
            usable.append((c, d))

    for c, d in usable:
        if _distance_to_segment(a, c, d) <= epsilon:
            return SightResult(SightState.OBSERVER_ON_OBSTACLE, ignored)
    if a == b:
        return SightResult(SightState.CLEAR, ignored)
    for c, d in usable:
        if _blocked_by(a, b, c, d, epsilon):
            return SightResult(SightState.BLOCKED, ignored)
    return SightResult(SightState.CLEAR, ignored)
