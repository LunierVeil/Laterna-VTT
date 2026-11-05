"""Immutable prepared geometry: compare both the public baseline and exact oracle."""
from dataclasses import FrozenInstanceError
from math import nextafter
from random import Random

import pytest

import app.line_of_sight as los
from .test_los_geometry import _reference_sight


def prepare(walls, **kwargs):
    return los.PreparedGeometry(walls, width=8192, height=8192, **kwargs)


def test_preparation_copies_every_nested_mutable_input():
    source = [[[350., 0.], [350., 350.]], [[10., 10.], [10., 10.]]]
    prepared = prepare(source)
    source[0][0][0] = 999.
    source[0][1].clear()
    source.clear()
    result = prepared.point_sight((100., 100.), (600., 100.))
    assert result == los.SightResult(los.SightState.BLOCKED, 1)
    with pytest.raises(FrozenInstanceError):
        prepared.width = 12
    with pytest.raises(TypeError):
        prepared._segments[0] = None
    with pytest.raises(FrozenInstanceError):
        prepared._segments[0].a = (0., 0.)


def test_no_revalidation_or_fraction_conversion_of_walls_per_ray(monkeypatch):
    prepared = prepare([((350., 0.), (350., 350.))] * 200)
    converted, validated = [], []
    exact, point = los._exact_point, los._point
    def tracked_exact(value):
        converted.append(value)
        return exact(value)
    def tracked_point(*args):
        validated.append(args[1])
        return point(*args)
    monkeypatch.setattr(los, "_exact_point", tracked_exact)
    monkeypatch.setattr(los, "_point", tracked_point)
    for _ in range(3):
        assert prepared.point_sight((100., 100.), (600., 100.)).state is los.SightState.BLOCKED
    assert converted == [(100., 100.), (600., 100.)] * 3
    assert validated == ["observer", "target"] * 3


@pytest.mark.parametrize("walls", [None, [((1., 1.),)], [((0., 0.), (float('nan'), 2.))],
                                   [((0., 0.), (8193., 2.))]])
def test_all_invalid_geometry_fails_during_preparation(walls):
    with pytest.raises(ValueError):
        prepare(walls)


@pytest.mark.parametrize("a,b,walls", [
    ((350., 100.), (350., 100.), [((350., 0.), (350., 350.))]),
    ((100., 100.), (600., 100.), [((350., 100.), (350., 350.))]),
    ((100., 100.), (100., 100.), []),
    ((1., 0.), (8., 0.), [((4., 0.), (4., nextafter(0., 1.)))]),
    ((0., 1e-7), (8., 1e-7), [((3., 0.), (7., 0.))]),
    ((1e-7, 4.), (8., 4.), [((0., 0.), (0., 8.))]),
    ((0., 0.), (8192., 8192.), [((4096., 0.), (4096., 8192.))]),
    ((2.69999992, 3.60000006), (1., 100.), [((0., 0.), (3., 4.))]),
])
def test_boundary_states_and_diagnostics_equal_baseline_and_oracle(a, b, walls):
    for variant in (walls, [w[::-1] for w in reversed(walls)]):
        variant = variant + [((0., 0.), (0., 0.))]
        result = prepare(iter(variant)).point_sight(a, b)
        assert result == los.point_sight(a, b, variant, width=8192, height=8192)
        assert result.state is _reference_sight(a, b, variant)
        assert result.ignored_zero_length == 1


@pytest.mark.parametrize("count", [200, 2000, 10000])
def test_large_prepared_geometry_reused_without_losing_diagnostics(count):
    walls = [((float(i % 8192), 500.), (float(i % 8192), 600.)) for i in range(count)]
    walls += [((4000., 100.), (4000., 200.)), ((0., 0.), (0., 0.))]
    prepared = prepare(walls)
    for a, b in [((0., 100.), (8192., 100.)), ((0., 50.), (8192., 50.))]:
        assert prepared.point_sight(a, b) == los.point_sight(a, b, walls, width=8192, height=8192)


def test_deterministic_prepared_queries_match_independent_exact_oracle():
    rng = Random(3103)
    for _ in range(120):
        walls = [(tuple(rng.uniform(0, 8192) for _ in range(2)),
                  tuple(rng.uniform(0, 8192) for _ in range(2))) for _ in range(12)]
        prepared = prepare(walls)
        for _ in range(8):
            a, b = [tuple(rng.uniform(0, 8192) for _ in range(2)) for _ in range(2)]
            result = prepared.point_sight(a, b)
            assert result.state is _reference_sight(a, b, walls)
            assert result == los.point_sight(a, b, walls, width=8192, height=8192)


def test_prepared_query_still_validates_both_points():
    prepared = prepare([])
    for a, b in [((float('nan'), 0.), (0., 0.)), ((0., 0.), (9000., 0.))]:
        with pytest.raises(ValueError):
            prepared.point_sight(a, b)


@pytest.mark.parametrize("factor", [0.5, 1., 2.])
def test_prepared_epsilon_band_near_origin_and_map_edge(factor):
    from math import inf
    for y in (0., 8191.):
        level = y + los.INITIAL_EPSILON_PX * factor
        walls = [((3., y), (7., y))]
        prepared = prepare(walls)
        for yy in (nextafter(level, -inf), level, nextafter(level, inf)):
            if yy < 0:
                continue
            a, b = (1., yy), (8., yy)
            assert prepared.point_sight(a, b) == los.point_sight(a, b, walls, width=8192, height=8192)
            assert prepared.point_sight(a, b).state is _reference_sight(a, b, walls)


def test_prepared_common_corner_and_short_nonzero_wall_stay_opaque():
    for walls in ([((350., 0.), (350., 350.)), ((350., 350.), (700., 350.))],
                  [((350., 100.), (350., 100. + 5e-8))]):
        a, b = ((105., 105.), (595., 595.)) if len(walls) == 2 else ((100., 100.), (600., 100.))
        assert prepare(walls).point_sight(a, b).state is los.SightState.BLOCKED
        assert prepare([w[::-1] for w in reversed(walls)]).point_sight(a, b).state is los.SightState.BLOCKED
