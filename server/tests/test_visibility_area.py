"""Visibility preparation and contours: synthetic geometry only."""
from dataclasses import FrozenInstanceError
from fractions import Fraction as F
from math import nextafter

import pytest

from app.line_of_sight import PreparedGeometry, SightState
from app.visibility_area import PreparedVisibilityGeometry


def prepare(walls=(), size=(100., 100.)):
    return PreparedVisibilityGeometry(PreparedGeometry(walls, width=size[0], height=size[1]))


def test_readonly_projection_and_preparation_keep_source_diagnostics():
    walls = [[[50., 0.], [50., 100.]], [[5., 5.], [5., 5.]]]
    source = PreparedGeometry(walls, width=100, height=100)
    projection = source.opaque_segments
    prepared = PreparedVisibilityGeometry(source)
    walls.clear()
    assert projection == (((50., 0.), (50., 100.)),)
    assert prepared.unique_segment_count == 1
    result = prepared.point_sight((10., 50.), (90., 50.))
    assert result.state is SightState.BLOCKED and result.ignored_zero_length == 1
    with pytest.raises(FrozenInstanceError):
        prepared.unique_segment_count = 999
    with pytest.raises(TypeError):
        prepared.event_points[0] = (F(0), F(0))


def test_all_nonparallel_intersections_become_exact_events():
    walls = [((10., 10.), (90., 90.)), ((10., 90.), (90., 10.)),
             ((50., 50.), (70., 50.))]
    prepared = prepare(walls)
    assert (F(50), F(50)) in prepared.event_points
    assert prepared.intersection_point_count == 1
    assert prepared.candidate_pair_count == 3


def test_fractional_intersection_is_not_rounded_to_binary64():
    prepared = prepare([((0., 0.), (3., 1.)), ((1., 0.), (1., 1.))])
    assert (F(1), F(1, 3)) in prepared.event_points


def test_overlaps_duplicates_and_reversal_have_canonical_events():
    walls = [((10., 50.), (60., 50.)), ((30., 50.), (80., 50.))]
    first = prepare(walls)
    other = prepare([walls[1][::-1], walls[0], walls[0][::-1]])
    assert first.event_points == other.event_points
    assert first._segments == other._segments
    assert first.unique_segment_count == other.unique_segment_count == 2
    assert first.intersection_point_count == 0


def test_subnormal_nonzero_segment_remains_an_event_pair():
    prepared = prepare([((10., 0.), (10., nextafter(0., 1.)))])
    assert prepared.unique_segment_count == 1
    assert (F(10), F(nextafter(0., 1.))) in prepared.event_points


@pytest.mark.parametrize("count", [200, 2000, 10000])
def test_disjoint_boxes_do_not_degenerate_into_all_pairs(count):
    walls = [((i / 2., 10.), (i / 2., 20.)) for i in range(1, count + 1)]
    prepared = prepare(walls, size=(8192., 100.))
    assert prepared.unique_segment_count == count
    assert prepared.intersection_point_count == prepared.candidate_pair_count == 0
