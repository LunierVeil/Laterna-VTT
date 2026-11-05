"""PB-01d-1: immutable events for an experimental, zero-width visibility contour.

Exact point visibility remains PreparedGeometry.point_sight, including epsilon.
No lighting, FoW, database, access policy, networking or renderer integration.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from fractions import Fraction
from typing import TypeAlias

from .line_of_sight import Point, PreparedGeometry, SightResult

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

    def point_sight(self, observer: Point, target: Point) -> SightResult:
        """The exact oracle, never polygon containment; same snapshot lifetime."""
        return self._source.point_sight(observer, target)
