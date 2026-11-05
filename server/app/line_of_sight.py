"""PB-01a/PB-01b: pure point-to-point sight calculation for prepared opaque segments.

No database, roles, scene projection, window/secret-door policy, lighting or FoW.
A CLEAR answer does NOT grant permission to disclose an object to a player.
Movement geometry has different epsilon units and must not be reused here.

See docs/PB01_VISIBILITY_RULES.md. Boundary behaviors and numerical tolerance
remain candidates for independent architectural review before integration.
PB-01b uses conservative float filters only to skip provably irrelevant walls;
all LOS decisions still use exact Fraction geometry.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from fractions import Fraction
from math import inf, isfinite, nextafter
from typing import Iterable, TypeAlias

Point: TypeAlias = tuple[float, float]
Segment: TypeAlias = tuple[Point, Point]
_ExactPoint: TypeAlias = tuple[Fraction, Fraction]
_Bounds: TypeAlias = tuple[float, float, float, float]  # min_x, max_x, min_y, max_y
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


def _bounds(a: Point, b: Point) -> _Bounds:
    return min(a[0], b[0]), max(a[0], b[0]), min(a[1], b[1]), max(a[1], b[1])


def _expanded_bounds(a: Point, b: Point, epsilon: float) -> _Bounds:
    """Conservative float enclosure of the exact epsilon-expanded ray AABB.

    One nextafter step outwards compensates for the rounding of each finite
    addition/subtraction. Over-inclusive boxes cost speed, never correctness.
    Do not shrink/round these bounds: they determine which walls may safely
    bypass the exact Fraction predicate.
    """
    low_x, high_x, low_y, high_y = _bounds(a, b)
    return (nextafter(low_x - epsilon, -inf), nextafter(high_x + epsilon, inf),
            nextafter(low_y - epsilon, -inf), nextafter(high_y + epsilon, inf))


def _overlaps(left: _Bounds, right: _Bounds) -> bool:
    return (left[0] <= right[1] and left[1] >= right[0]
            and left[2] <= right[3] and left[3] >= right[2])


def _interval_sub_numbers(x: float, y: float) -> tuple[float, float]:
    """Outward interval for exact subtraction of the stored binary64 numbers."""
    result = x - y
    if not isfinite(result):
        return -inf, inf
    return nextafter(result, -inf), nextafter(result, inf)


def _interval_mul(a: tuple[float, float], b: tuple[float, float]) -> tuple[float, float]:
    candidates = (a[0] * b[0], a[0] * b[1], a[1] * b[0], a[1] * b[1])
    if not all(isfinite(x) for x in candidates):
        return -inf, inf
    return nextafter(min(candidates), -inf), nextafter(max(candidates), inf)


def _interval_sub(a: tuple[float, float], b: tuple[float, float]) -> tuple[float, float]:
    lo, hi = a[0] - b[1], a[1] - b[0]
    if not isfinite(lo) or not isfinite(hi):
        return -inf, inf
    return nextafter(lo, -inf), nextafter(hi, inf)


def _provably_off_ray(a: Point, ray_dx: tuple[float, float],
                      ray_dy: tuple[float, float], c: Point, d: Point,
                      radius_upper: float) -> bool:
    """Certify the entire wall is farther than epsilon from the ray line.

    When both wall endpoints are on one side and signed area exceeds
    epsilon * |ray|, linearity guarantees the entire wall stays off the line.
    Outward-rounded intervals certify the comparison. Uncertain/overflowing
    floats always fall through to exact Fractions, never force CLEAR.
    """
    if not isfinite(radius_upper):
        return False

    def area(p: Point) -> tuple[float, float]:
        vx = _interval_sub_numbers(p[0], a[0])
        vy = _interval_sub_numbers(p[1], a[1])
        return _interval_sub(_interval_mul(ray_dx, vy), _interval_mul(ray_dy, vx))

    lo_c, hi_c = area(c)
    lo_d, hi_d = area(d)
    return ((lo_c > radius_upper and lo_d > radius_upper)
            or (hi_c < -radius_upper and hi_d < -radius_upper))


def _ray_radius_upper(a: Point, b: Point, epsilon: float):
    """Upper bound on epsilon * ray length using the L1 norm, no sqrt."""
    dx = _interval_sub_numbers(b[0], a[0])
    dy = _interval_sub_numbers(b[1], a[1])
    # L1 >= L2; one outward step covers the sum and multiplication.
    norm_upper = nextafter(max(abs(dx[0]), abs(dx[1]))
                           + max(abs(dy[0]), abs(dy[1])), inf)
    radius_upper = nextafter(epsilon * norm_upper, inf)
    return dx, dy, radius_upper


def _exact_point(point: Point) -> _ExactPoint:
    return Fraction(point[0]), Fraction(point[1])


def point_sight(
    observer: Point,
    target: Point,
    opaque_segments: Iterable[Segment],
    *,
    width: float,
    height: float,
    epsilon: float = INITIAL_EPSILON_PX,
) -> SightResult:
    """Classify a scene-pixel ray; grid, camera and D&D rules are not inputs.

    Validate *every* obstacle before a result can be returned (even if an
    earlier obstacle blocks the ray). This preserves the PB-01a fail-closed
    behavior for malformed input and the ignored_zero_length diagnostic.

    Broad-phase filters are conservative: Fraction makes every final LOS
    decision. No live Wall->opaque conversion, auth, light, cache or FoW.
    """
    width, height = _number(width, "width"), _number(height, "height")
    epsilon = _number(epsilon, "epsilon")
    if width <= 0 or height <= 0 or epsilon <= 0:
        raise ValueError("scene dimensions and epsilon must be positive")
    a = _point(observer, "observer", width, height)
    b = _point(target, "target", width, height)

    # Validate all walls and count exactly zero-length segments first.
    usable: list[tuple[Point, Point, _Bounds]] = []
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
            usable.append((c, d, _bounds(c, d)))

    observer_box = _expanded_bounds(a, a, epsilon)
    a_exact = _exact_point(a)
    epsilon_squared = Fraction(epsilon) ** 2
    for c, d, wall_box in usable:
        if _overlaps(observer_box, wall_box):
            if _distance_squared(a_exact, _exact_point(c), _exact_point(d)) <= epsilon_squared:
                return SightResult(SightState.OBSERVER_ON_OBSTACLE, ignored)
    if a == b:
        return SightResult(SightState.CLEAR, ignored)

    ray_box = _expanded_bounds(a, b, epsilon)
    b_exact = _exact_point(b)
    ray_dx, ray_dy, radius_upper = _ray_radius_upper(a, b, epsilon)
    for c, d, wall_box in usable:
        if not _overlaps(ray_box, wall_box):
            continue
        if _provably_off_ray(a, ray_dx, ray_dy, c, d, radius_upper):
            continue
        if _blocked_by(a_exact, b_exact, _exact_point(c), _exact_point(d), epsilon_squared):
            return SightResult(SightState.BLOCKED, ignored)
    return SightResult(SightState.CLEAR, ignored)
