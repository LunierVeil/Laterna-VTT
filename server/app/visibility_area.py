"""PB-01d-1: immutable events for an experimental, zero-width visibility contour.

Exact point visibility remains PreparedGeometry.point_sight, including epsilon.
No lighting, FoW, database, access policy, networking or renderer integration.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from fractions import Fraction
from functools import cmp_to_key
from heapq import heappop, heappush
from math import gcd, lcm
from typing import TypeAlias

from .line_of_sight import Point, PreparedGeometry, SightResult, SightState

ExactPoint: TypeAlias = tuple[Fraction, Fraction]
_ExactSegment: TypeAlias = tuple[ExactPoint, ExactPoint]
_Box: TypeAlias = tuple[Fraction, Fraction, Fraction, Fraction]


def _cross(a, b):
    return a[0] * b[1] - a[1] * b[0]


def _sub(a, b):
    return a[0] - b[0], a[1] - b[1]


def _bounds(segment: _ExactSegment) -> _Box:
    a, b = segment
    return min(a[0], b[0]), max(a[0], b[0]), min(a[1], b[1]), max(a[1], b[1])


def _overlaps(a: _Box, b: _Box) -> bool:
    return a[0] <= b[1] and b[0] <= a[1] and a[2] <= b[3] and b[2] <= a[3]


@dataclass(frozen=True, slots=True)
class _Node:
    bounds: _Box
    index: int | None = None
    left: _Node | None = None
    right: _Node | None = None


def _tree(boxes: tuple[_Box, ...], indices: list[int]) -> _Node | None:
    if not indices:
        return None
    bounds = (min(boxes[i][0] for i in indices), max(boxes[i][1] for i in indices),
              min(boxes[i][2] for i in indices), max(boxes[i][3] for i in indices))
    if len(indices) == 1:
        return _Node(bounds, indices[0])
    axis = 0 if bounds[1] - bounds[0] >= bounds[3] - bounds[2] else 2
    ordered = sorted(indices, key=lambda i: (boxes[i][axis] + boxes[i][axis + 1], i))
    middle = len(ordered) // 2
    return _Node(bounds, left=_tree(boxes, ordered[:middle]), right=_tree(boxes, ordered[middle:]))


def _box_candidates(root: _Node | None, box: _Box):
    stack = [root] if root else []
    while stack:
        node = stack.pop()
        if not _overlaps(box, node.bounds):
            continue
        if node.index is not None:
            yield node.index
        else:
            stack.extend((node.left, node.right))


def _intersection(first: _ExactSegment, second: _ExactSegment) -> ExactPoint | None:
    a, b = first
    c, d = second
    u, v, offset = _sub(b, a), _sub(d, c), _sub(c, a)
    denominator = _cross(u, v)
    if not denominator:
        # All endpoints of collinear overlaps are already events. Do not invent
        # a single intersection for infinitely many coincident points.
        return None
    t, s = _cross(offset, v) / denominator, _cross(offset, u) / denominator
    if 0 <= t <= 1 and 0 <= s <= 1:
        return a[0] + t * u[0], a[1] + t * u[1]
    return None


@dataclass(frozen=True, slots=True, init=False)
class PreparedVisibilityGeometry:
    """Derived snapshot. BVH only accelerates exact raw-segment event queries.

    All endpoint/intersection events are retained; no angular sample count,
    coordinate rounding, epsilon merging or silent work cap is introduced.
    """
    _source: PreparedGeometry = field(repr=False)
    _segments: tuple[_ExactSegment, ...] = field(repr=False)
    _root: _Node | None = field(repr=False)
    event_points: tuple[ExactPoint, ...] = field(repr=False)
    unique_segment_count: int
    intersection_point_count: int
    candidate_pair_count: int

    def __init__(self, geometry: PreparedGeometry):
        if not isinstance(geometry, PreparedGeometry):
            raise TypeError("expected PreparedGeometry")
        unique = set()
        for a, b in geometry.opaque_segments:
            a = (Fraction(a[0]), Fraction(a[1]))
            b = (Fraction(b[0]), Fraction(b[1]))
            unique.add(tuple(sorted((a, b))))
        segments = tuple(sorted(unique))
        boxes = tuple(_bounds(segment) for segment in segments)
        root = _tree(boxes, list(range(len(segments))))
        points = {point for segment in segments for point in segment}
        width, height = Fraction(geometry.width), Fraction(geometry.height)
        points.update(((Fraction(0), Fraction(0)), (width, Fraction(0)),
                       (width, height), (Fraction(0), height)))
        intersections = set()
        pairs = 0
        for i, box in enumerate(boxes):
            for j in _box_candidates(root, box):
                if j <= i:
                    continue
                pairs += 1
                point = _intersection(segments[i], segments[j])
                if point is not None:
                    intersections.add(point)
        points.update(intersections)
        for name, value in (("_source", geometry), ("_segments", segments), ("_root", root),
                            ("event_points", tuple(sorted(points))),
                            ("unique_segment_count", len(segments)),
                            ("intersection_point_count", len(intersections)),
                            ("candidate_pair_count", pairs)):
            object.__setattr__(self, name, value)

    def visibility_area(self, observer: Point) -> VisibilityArea:
        """Build the approximate event contour; reuse this immutable preparation."""
        return _visibility_area(self, observer)

    def point_sight(self, observer: Point, target: Point) -> SightResult:
        """The exact oracle, never polygon containment; same snapshot lifetime."""
        return self._source.point_sight(observer, target)


class AreaState(str, Enum):
    READY = "ready"
    OBSERVER_ON_OBSTACLE = "observer_on_obstacle"


@dataclass(frozen=True, slots=True)
class VisibilityArea:
    """Experimental zero-width contour, NOT a disclosure/containment decision.

    Vertices are exact rationals, but epsilon capsules are not represented.
    Radial retraces at isolated endpoint contacts make this weakly simple;
    consumers must not assume a certified simple polygon or safe inner bound.
    """
    observer: Point
    state: AreaState
    contour: tuple[ExactPoint, ...] | None
    direction_count: int
    ignored_zero_length: int
    _source: PreparedGeometry = field(repr=False)
    quality: str = field(default="approximate_zero_width", init=False)

    def point_sight(self, target: Point) -> SightResult:
        """Authoritative *geometry* answer, never authorization; no polygon test."""
        return self._source.point_sight(self.observer, target)


def _direction(offset: ExactPoint) -> tuple[int, int]:
    denominator = lcm(offset[0].denominator, offset[1].denominator)
    x, y = (int(component * denominator) for component in offset)
    divisor = gcd(abs(x), abs(y))
    return x // divisor, y // divisor


def _angle_compare(a, b):
    half_a = 0 if a[1] > 0 or (a[1] == 0 and a[0] >= 0) else 1
    half_b = 0 if b[1] > 0 or (b[1] == 0 and b[0] >= 0) else 1
    if half_a != half_b:
        return half_a - half_b
    cross = _cross(a, b)
    return -1 if cross > 0 else 1 if cross < 0 else 0


def _between(a, b):
    """One exact interior direction in a CCW angular cell, not an angle delta."""
    cross = _cross(a, b)
    if cross == 0:
        return -a[1], a[0]  # distinct, opposite directions
    sign = 1 if cross > 0 else -1  # wrapping gap can exceed pi at a scene corner
    return sign * (a[0] + b[0]), sign * (a[1] + b[1])


def _scene_exit(origin, direction, width, height):
    candidates = []
    for coordinate, component, bound in zip(origin, direction, (width, height)):
        if component:
            candidates.append(((bound if component > 0 else 0) - coordinate) / component)
    return min(candidates)


def _ray_box_entry(origin, direction, box, limit):
    low, high = Fraction(0), limit
    for coordinate, component, start, stop in zip(origin, direction, box[::2], box[1::2]):
        if not component:
            if not start <= coordinate <= stop:
                return None
        else:
            first, second = (start - coordinate) / component, (stop - coordinate) / component
            low, high = max(low, min(first, second)), min(high, max(first, second))
            if low > high:
                return None
    return low


def _wall_hit(origin, direction, segment, limit):
    a, b = segment
    offset, vector = _sub(a, origin), _sub(b, a)
    denominator = _cross(direction, vector)
    if denominator:
        t, u = _cross(offset, vector) / denominator, _cross(offset, direction) / denominator
        return t if 0 <= t <= limit and 0 <= u <= 1 else None
    if _cross(offset, direction):
        return None
    axis = 0 if direction[0] else 1
    start, end = sorted(((a[axis] - origin[axis]) / direction[axis],
                         (b[axis] - origin[axis]) / direction[axis]))
    t = max(Fraction(0), start)
    return t if end >= 0 and t <= limit else None


@dataclass(frozen=True, slots=True)
class _Front:
    distance: Fraction
    wall: int | None = None
    outside: bool = False


def _nearest(prepared, origin, direction):
    limit = _scene_exit(origin, direction, Fraction(prepared._source.width),
                        Fraction(prepared._source.height))
    if limit == 0:
        return _Front(limit, outside=True)
    best, winner = limit, None
    root = prepared._root
    queue, serial = [], 0
    if root is not None:
        entry = _ray_box_entry(origin, direction, root.bounds, best)
        if entry is not None:
            heappush(queue, (entry, serial, root))
    while queue:
        entry, _, node = heappop(queue)
        if entry > best:
            break
        if node.index is not None:
            hit = _wall_hit(origin, direction, prepared._segments[node.index], best)
            if hit is not None and (hit < best or winner is None or node.index < winner):
                best, winner = hit, node.index
        else:
            for child in (node.left, node.right):
                entry = _ray_box_entry(origin, direction, child.bounds, best)
                if entry is not None:
                    serial += 1
                    heappush(queue, (entry, serial, child))
    return _Front(best, winner)


def _project(prepared, origin, direction, front):
    if front.outside:
        return origin
    limit = _scene_exit(origin, direction, Fraction(prepared._source.width),
                        Fraction(prepared._source.height))
    distance = limit if front.wall is None else _wall_hit(
        origin, direction, prepared._segments[front.wall], limit)
    if distance is None:
        # Never hide a broken cell invariant with an unobstructed scene fallback.
        raise ArithmeticError("angular cell winner does not meet its event boundary")
    return origin[0] + distance * direction[0], origin[1] + distance * direction[1]


def _visibility_area(prepared: PreparedVisibilityGeometry, observer: Point) -> VisibilityArea:
    check = prepared._source.point_sight(observer, observer)  # validates before deriving anything
    observer = (float(observer[0]), float(observer[1]))  # copy caller-owned lists
    if check.state is SightState.OBSERVER_ON_OBSTACLE:
        return VisibilityArea(observer, AreaState.OBSERVER_ON_OBSTACLE, None, 0,
                              check.ignored_zero_length, prepared._source)
    origin = Fraction(observer[0]), Fraction(observer[1])
    directions = sorted({_direction(_sub(point, origin)) for point in prepared.event_points
                         if point != origin}, key=cmp_to_key(_angle_compare))
    cells = [_nearest(prepared, origin, _between(direction, directions[(i + 1) % len(directions)]))
             for i, direction in enumerate(directions)]
    contour = []
    for i, direction in enumerate(directions):
        exact = _nearest(prepared, origin, direction)
        for front in (cells[i - 1], exact, cells[i]):
            point = _project(prepared, origin, direction, front)
            if not contour or point != contour[-1]:
                contour.append(point)
    if len(contour) > 1 and contour[-1] == contour[0]:
        contour.pop()
    return VisibilityArea(observer, AreaState.READY, tuple(contour), len(directions),
                          check.ignored_zero_length, prepared._source)
