"""Геометрия ручного тумана. Без сервера: cd server && pytest tests."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import fog  # noqa: E402


def R(x, y, w, h):
    return fog.make(x, y, w, h)


def boxes(rects):
    return sorted((r["x"], r["y"], r["w"], r["h"]) for r in rects)


def test_no_overlap_keeps_rect_and_id():
    r = R(0, 0, 100, 100)
    assert fog.subtract(r, R(200, 200, 10, 10)) == [r]


def test_touching_edges_is_not_overlap():
    r = R(0, 0, 100, 100)
    assert fog.subtract(r, R(100, 0, 50, 100)) == [r]  # справа впритык
    assert fog.subtract(r, R(0, 100, 100, 50)) == [r]  # снизу впритык
    assert fog.subtract(r, R(100, 100, 5, 5)) == [r]  # угол в угол


def test_full_cover_removes_rect():
    assert fog.subtract(R(10, 10, 50, 50), R(0, 0, 100, 100)) == []
    assert fog.subtract(R(10, 10, 50, 50), R(10, 10, 50, 50)) == []


def test_hole_in_middle_gives_four_pieces():
    pieces = fog.subtract(R(0, 0, 100, 100), R(40, 40, 20, 20))
    assert boxes(pieces) == sorted([(0, 0, 100, 40), (0, 60, 100, 40), (0, 40, 40, 20), (60, 40, 40, 20)])
    assert fog.area(pieces) == 100 * 100 - 20 * 20


def test_cut_from_one_side_and_corner():
    assert boxes(fog.subtract(R(0, 0, 100, 100), R(50, -10, 100, 200))) == [(0, 0, 50, 100)]
    corner = fog.subtract(R(0, 0, 100, 100), R(70, 70, 50, 50))
    assert fog.area(corner) == 100 * 100 - 30 * 30
    assert len(corner) == 2


def test_reveal_over_several_and_union_area():
    rects = [R(0, 0, 100, 100), R(50, 50, 100, 100)]
    cut = R(40, 40, 70, 70)
    out = fog.reveal(rects, cut)
    # Вырез торчит из тумана (угол около 105,45 не закрыт) - вычитается только
    # та его часть, что была под туманом.
    outside = [cut]
    for r in rects:
        outside = [p for piece in outside for p in fog.subtract(piece, r)]
    under_fog = cut["w"] * cut["h"] - fog.area(outside)
    assert fog.area(out) == fog.area(rects) - under_fog
    assert not any(fog.overlaps(p, cut) for p in out)


def test_point_and_segment():
    rects = [R(0, 0, 100, 100)]
    assert fog.contains_point(rects, 50, 50)
    assert fog.contains_point(rects, 100, 100)  # край - под туманом
    assert not fog.contains_point(rects, 101, 50)
    assert fog.covers_segment(rects, 10, 10, 90, 10)
    assert not fog.covers_segment(rects, 10, 10, 190, 10)  # торчит наружу


def test_piece_ids_unique():
    pieces = fog.subtract(R(0, 0, 100, 100), R(40, 40, 20, 20))
    assert len({p["id"] for p in pieces}) == 4
