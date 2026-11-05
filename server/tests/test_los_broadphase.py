"""PB-01b: conservative LOS filters must match the independent Fraction oracle.

Timing is not gated by CI: shared runner speed is not a performance contract.
"""
from __future__ import annotations

from math import hypot, nextafter
from random import Random

import pytest

import app.line_of_sight as los
from app.line_of_sight import INITIAL_EPSILON_PX, SightState, point_sight
from .test_los_geometry import _reference_sight


def check(a, b, walls, epsilon=INITIAL_EPSILON_PX):
    return point_sight(a, b, walls, width=8192, height=8192, epsilon=epsilon)


@pytest.mark.parametrize("a,b,walls,expected", [
    ((105, 105), (805, 105), [((350, 0), (350, 350))], SightState.BLOCKED),
    ((105, 105), (300, 105), [((350, 0), (350, 350))], SightState.CLEAR),
    ((350, 100), (600, 100), [((350, 0), (350, 350))], SightState.OBSERVER_ON_OBSTACLE),
    ((350, 100), (350, 100), [((350, 0), (350, 350))], SightState.OBSERVER_ON_OBSTACLE),
    ((100, 100), (100, 100), [((350, 0), (350, 350))], SightState.CLEAR),
    ((100, 100), (600, 100), [((350, 100), (350, 350))], SightState.BLOCKED),
    ((0, 0), (8192, 8192), [((4096, 0), (4096, 8192))], SightState.BLOCKED),
])
def test_analytic_cases_match_oracle(a, b, walls, expected):
    assert check(a, b, walls).state is expected
    assert _reference_sight(a, b, walls) is expected


@pytest.mark.parametrize("a,b,wall,expected", [
    ((2.69999992, 3.60000006), (1., 100.), ((0., 0.), (3., 4.)), SightState.OBSERVER_ON_OBSTACLE),
    ((6296.770485783843, 4107.197161628372), (2735.8377903889377, 69.77382087266687),
     ((6348.52441975517, 4144.710791430352),
      (5347.184211375355, 3418.89339211657)), SightState.OBSERVER_ON_OBSTACLE),
    ((0.74999992, 1.00000006), (1., 100.), ((0., 0.), (3., 4.)), SightState.CLEAR),
])
def test_fraction_boundary_regressions_even_with_reversed_wall(a, b, wall, expected):
    for segment in (wall, wall[::-1]):
        assert check(a, b, [segment]).state is expected
        assert _reference_sight(a, b, [segment]) is expected


@pytest.mark.parametrize("factor,expected", [
    (0.5, SightState.BLOCKED),
    (1., SightState.BLOCKED),
    (2., SightState.CLEAR),
])
def test_endpoint_epsilon_tangency(factor, expected):
    delta = INITIAL_EPSILON_PX * factor
    a, b = (100., 100. - delta), (600., 100. - delta)
    walls = [((350., 100.), (350., 350.))]
    assert check(a, b, walls).state is expected
    assert _reference_sight(a, b, walls) is expected


def test_invalid_wall_checked_after_early_block_and_observer_diagnostic():
    walls = [((350, 0), (350, 350)), ((500, 0), (500, float("nan")))]
    for observer in ((100, 100), (350, 100)):
        with pytest.raises(ValueError):
            check(observer, (700, 100), walls)


def test_zero_length_diagnostics_preserved_and_subnormal_not_discarded():
    zero = ((300., 100.), (300., 100.))
    short = ((350., 100.), (350., 100. + 5e-8))
    result = check((100., 100.), (600., 100.), [zero, short])
    assert result.state is SightState.BLOCKED
    assert result.ignored_zero_length == 1
    tiny = nextafter(0., 1.)
    assert check((1., 0.), (8., 0.), [((4., 0.), (4., tiny))]).state is SightState.BLOCKED


@pytest.mark.parametrize("kind", ["outside_ray_box", "inside_diagonal_box"])
def test_remote_walls_skip_exact_conversion_without_false_clear(monkeypatch, kind):
    if kind == "outside_ray_box":
        a, b = (0., 100.), (2100., 100.)
        walls = [((float(x), 500.), (float(x), 600.)) for x in range(1, 2001)]
    else:
        a, b = (0., 0.), (2100., 2100.)
        walls = [((500. + (i % 100), 1500. + (i // 100)),
                  (550. + (i % 100), 1600. + (i // 100))) for i in range(2000)]
    count = 0
    original = los._exact_point

    def tracked(p):
        nonlocal count
        count += 1
        return original(p)

    monkeypatch.setattr(los, "_exact_point", tracked)
    assert check(a, b, walls).state is SightState.CLEAR
    assert count == 2  # observer and target; 2000 walls require no Fraction


def test_obstacle_order_and_reversal_do_not_change_classification():
    distant = [((float(x), 500.), (float(x), 600.)) for x in range(1, 2001)]
    block = ((1000., 100.), (1000., 350.))
    for walls in (distant + [block], [block] + distant, list(reversed(distant)) + [block[::-1]]):
        assert check((0., 100.), (2100., 100.), iter(walls)).state is SightState.BLOCKED
        assert check((2100., 100.), (0., 100.), iter(walls)).state is SightState.BLOCKED


def test_extreme_small_and_large_tolerances_still_use_exact_fallback():
    tiny = nextafter(0., 1.)
    a, b = (0., 0.), (8., 0.)
    walls = [((4., tiny), (4., 10.))]
    assert check(a, b, walls, tiny).state is _reference_sight(a, b, walls, tiny)
    assert check(a, b, [walls[0][::-1]], tiny).state is _reference_sight(a, b, walls, tiny)
    a, b = (0., 0.), (100., 100.)
    walls = [((8000., 8000.), (8100., 8100.))]
    assert check(a, b, walls, 10000.).state is _reference_sight(a, b, walls, 10000.)


def test_deterministic_equivalence_for_near_parallel_and_reversed_geometry():
    rng = Random(3102)
    for index in range(1800):
        c = (rng.uniform(0, 8192), rng.uniform(0, 8192))
        d = (rng.uniform(0, 8192), rng.uniform(0, 8192))
        a = (rng.uniform(0, 8192), rng.uniform(0, 8192))
        b = (rng.uniform(0, 8192), rng.uniform(0, 8192))
        if index % 2 == 0:
            dx, dy = d[0] - c[0], d[1] - c[1]
            length = hypot(dx, dy)
            delta = INITIAL_EPSILON_PX * rng.choice((0.5, 1., 2.))
            a = (c[0] + dx * 0.25 - dy / length * delta,
                 c[1] + dy * 0.25 + dx / length * delta)
            b = (c[0] + dx * 0.75 - dy / length * delta,
                 c[1] + dy * 0.75 + dx / length * delta)
        if index % 10 == 0:
            a = (nextafter(8192., 0.), rng.uniform(0, 8192))
        if index % 25 == 0:
            b = a
        walls = [(c, d), ((0., 8192.), (0., 8192.))]
        for observer, target in ((a, b), (b, a)):
            expected = _reference_sight(observer, target, walls)
            for variant in (walls, [walls[0][::-1], walls[1]], list(reversed(walls))):
                result = check(observer, target, iter(variant))
                assert result.state is expected, (index, observer, target, variant)
                assert result.ignored_zero_length == 1


def test_many_random_walls_have_identical_result_to_independent_oracle():
    rng = Random(3112)
    for index in range(200):
        a = (rng.uniform(0, 8192), rng.uniform(0, 8192))
        b = (rng.uniform(0, 8192), rng.uniform(0, 8192))
        walls = [((rng.uniform(0, 8192), rng.uniform(0, 8192)),
                  (rng.uniform(0, 8192), rng.uniform(0, 8192))) for _ in range(12)]
        if index % 3 == 0:
            t = rng.uniform(0.2, 0.8)
            x, y = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
            walls.append(((x, y), (min(8192., x + 3.), min(8192., y + 5.))))
        expected = _reference_sight(a, b, walls)
        assert check(a, b, walls).state is expected
        assert check(a, b, [w[::-1] for w in reversed(walls)]).state is expected
