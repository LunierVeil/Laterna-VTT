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
from fractions import Fraction
from math import isfinite
from typing import Iterable, TypeAlias

Point: TypeAlias = tuple[float, float]
Segment: TypeAlias = tuple[Point, Point]
_ExactPoint: TypeAlias = tuple[Fraction, Fraction]
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


def _distance_squared(p: _ExactPoint, a: _ExactPoint, b: _ExactPoint) -> Fraction:
    dx, dy = b[0] - a[0], b[1] - a[1]
    px, py = p[0] - a[0], p[1] - a[1]
    length_squared = dx * dx + dy * dy
    projection = px * dx + py * dy
    if projection <= 0:
        return px * px + py * py
    if projection >= length_squared:
        return (p[0] - b[0]) ** 2 + (p[1] - b[1]) ** 2
    return px * px + py * py - projection * projection / length_squared


def _side(p: _ExactPoint, a: _ExactPoint, b: _ExactPoint) -> Fraction:
    return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])


def _blocked_by(a: _ExactPoint, b: _ExactPoint, c: _ExactPoint, d: _ExactPoint,
                epsilon_squared: Fraction) -> bool:
    c_side, d_side = _side(c, a, b), _side(d, a, b)
    a_side, b_side = _side(a, c, d), _side(b, c, d)
    crosses = ((c_side > 0 > d_side or c_side < 0 < d_side)
               and (a_side > 0 > b_side or a_side < 0 < b_side))
    return (crosses
            or _distance_squared(a, c, d) <= epsilon_squared
            or _distance_squared(b, c, d) <= epsilon_squared
            or _distance_squared(c, a, b) <= epsilon_squared
            or _distance_squared(d, a, b) <= epsilon_squared)


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

    # Preserve the supplied binary64 values exactly. Normalized float projection
    # can move a distance across epsilon when endpoints are reversed. Squared
    # rational comparisons avoid that extra rounding, sqrt and tiny-length division.
    # This does not recover precision already lost by the caller or choose epsilon.
    a = (Fraction(a[0]), Fraction(a[1]))
    b = (Fraction(b[0]), Fraction(b[1]))
    epsilon_squared = Fraction(epsilon) ** 2
    usable: list[tuple[_ExactPoint, _ExactPoint]] = []
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
            usable.append(((Fraction(c[0]), Fraction(c[1])),
                           (Fraction(d[0]), Fraction(d[1]))))

    for c, d in usable:
        if _distance_squared(a, c, d) <= epsilon_squared:
            return SightResult(SightState.OBSERVER_ON_OBSTACLE, ignored)
    if a == b:
        return SightResult(SightState.CLEAR, ignored)
    for c, d in usable:
        if _blocked_by(a, b, c, d, epsilon_squared):
            return SightResult(SightState.BLOCKED, ignored)
    return SightResult(SightState.CLEAR, ignored)
