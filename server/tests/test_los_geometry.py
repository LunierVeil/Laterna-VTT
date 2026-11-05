"""PB-01a pure LOS regression candidates; no database, browser or permissions."""

from __future__ import annotations

import pytest

from app.line_of_sight import INITIAL_EPSILON_PX, SightState, point_sight
from .fixtures.los_baseline import scenes


def sight(a, b, walls=(), *, size=(2100, 1400), epsilon=INITIAL_EPSILON_PX):
    return point_sight(a, b, walls, width=size[0], height=size[1], epsilon=epsilon)


def from_pb00(name):
    """Test-only filtering. No production window or secret wall adapter."""
    raw = scenes()[name]["walls"]
    assert all(w["kind"] in ("wall", "door") for w in raw)
    return [((w["x1"], w["y1"]), (w["x2"], w["y2"])) for w in raw
            if w["kind"] == "wall" or w["door_state"] != "open"]


@pytest.mark.parametrize("name,expected", [
    ("empty", SightState.CLEAR),
    ("straight", SightState.BLOCKED),
    ("corner", SightState.BLOCKED),
    ("door-closed", SightState.BLOCKED),
    ("door-open", SightState.CLEAR),
    ("door-locked", SightState.BLOCKED),
])
def test_pb00_fixtures_with_explicit_test_only_occluders(name, expected):
    assert sight((105, 105), (805, 105), from_pb00(name)).state is expected


def test_target_before_wall_and_empty_room():
    wall = ((350, 0), (350, 350))
    assert sight((105, 105), (300, 105), [wall]).state is SightState.CLEAR
    assert sight((105, 105), (805, 105), []).state is SightState.CLEAR


@pytest.mark.parametrize("wall", [
    ((350, 100), (350, 350)),
    ((350, 350), (350, 100)),
])
def test_exact_corner_contact_blocks_and_real_gap_passes(wall):
    assert sight((100, 100), (600, 100), [wall]).state is SightState.BLOCKED
    assert sight((100, 99), (600, 99), [wall]).state is SightState.CLEAR
    assert sight((100, 101), (600, 101), [wall]).state is SightState.BLOCKED


def test_end_target_at_wall_is_blocked():
    assert sight((100, 100), (350, 100), [((350, 0), (350, 350))]).state is SightState.BLOCKED


@pytest.mark.parametrize("walls", [
    [((200, 100), (400, 100))],
    [((300, 100), (500, 100)), ((200, 100), (400, 100))],
    [((400, 100), (200, 100)), ((500, 100), (300, 100))],
])
def test_overlap_duplicates_and_reversed_endpoints_block(walls):
    assert sight((100, 100), (600, 100), walls).state is SightState.BLOCKED
    assert sight((600, 100), (100, 100), walls).state is SightState.BLOCKED


def test_interior_crossing_without_endpoint_contact():
    assert sight((100, 100), (600, 600), [((100, 600), (600, 100))]).state is SightState.BLOCKED


def test_observer_on_wall_endpoint_and_corner_takes_precedence_over_same_point():
    wall = ((350, 0), (350, 350))
    for b in ((100, 100), (600, 100), (350, 100)):
        assert sight((350, 100), b, [wall]).state is SightState.OBSERVER_ON_OBSTACLE
    assert sight((350, 0), (600, 100), [wall]).state is SightState.OBSERVER_ON_OBSTACLE
    assert sight((350, 350), (350, 350), [wall, ((350, 350), (700, 350))]).state is SightState.OBSERVER_ON_OBSTACLE
    assert sight((100, 100), (100, 100), [wall]).state is SightState.CLEAR


def test_observer_within_epsilon_of_wall_has_same_diagnostic():
    wall = ((350, 0), (350, 350))
    assert sight((350 - INITIAL_EPSILON_PX / 2, 100), (100, 100), [wall]).state is SightState.OBSERVER_ON_OBSTACLE
    assert sight((350 - INITIAL_EPSILON_PX * 2, 100), (100, 100), [wall]).state is SightState.CLEAR


def test_zero_length_walls_are_ignored_and_reported_but_short_nonzero_blocks():
    zero = ((350, 100), (350, 100))
    result = sight((100, 100), (600, 100), [zero])
    assert result.state is SightState.CLEAR and result.ignored_zero_length == 1
    assert sight((350, 100), (600, 100), [zero]).state is SightState.CLEAR
    short = ((350, 100), (350, 100 + INITIAL_EPSILON_PX / 2))
    assert sight((100, 100), (600, 100), [short]).state is SightState.BLOCKED


@pytest.mark.parametrize("delta,expected", [
    (INITIAL_EPSILON_PX / 2, SightState.BLOCKED),
    (INITIAL_EPSILON_PX * 2, SightState.CLEAR),
])
def test_distance_from_endpoint_uses_linear_tolerance(delta, expected):
    assert sight((100, 100 - delta), (600, 100 - delta), [((350, 100), (350, 350))]).state is expected


@pytest.mark.parametrize("gap,expected", [
    (INITIAL_EPSILON_PX, SightState.BLOCKED),
    (4 * INITIAL_EPSILON_PX, SightState.CLEAR),
])
def test_narrow_gap(gap, expected):
    walls = [((350, 0), (350, 100)), ((350, 100 + gap), (350, 350))]
    assert sight((100, 100 + gap / 2), (600, 100 + gap / 2), walls).state is expected


def test_real_gap_without_window_semantics():
    walls = [((700, 0), (700, 140)), ((700, 280), (700, 350))]
    assert sight((600, 210), (800, 210), walls).state is SightState.CLEAR


def test_grid_and_zoom_are_not_inputs_to_sight():
    wall = ((350, 0), (350, 350))
    for grid in (10, 70, 400):
        _ = grid
        assert sight((105, 105), (805, 105), [wall]).state is SightState.BLOCKED


def test_scene_edges_and_fractional_coordinates():
    assert sight((0, 0), (8192, 8192), [((4096, 0), (4096, 8192))], size=(8192, 8192)).state is SightState.BLOCKED
    assert sight((0, 0), (8192, 8192), [], size=(8192, 8192)).state is SightState.CLEAR
    assert sight((101.125, 200.375), (309.5, 200.375), []).state is SightState.CLEAR


@pytest.mark.parametrize("bad", [float("nan"), float("inf"), -1.0, 9000.0, True, "20", 1e10000])
def test_invalid_observer_coordinates_fail_closed(bad):
    with pytest.raises(ValueError):
        sight((bad, 100), (600, 100))


@pytest.mark.parametrize("walls", [
    [((350, float("nan")), (350, 350))],
    [((350, True), (350, 350))],
    [((350, 100), (350, 1400.01))],
    [((350, 100), (350, 140)), ((350, 100), (350, "200"))],
    [((350, 100),)],
])
def test_every_wall_validated_before_short_circuit(walls):
    with pytest.raises(ValueError):
        sight((100, 100), (600, 100), walls)


@pytest.mark.parametrize("width,height,epsilon", [
    (0, 1400, INITIAL_EPSILON_PX),
    (2100, -1, INITIAL_EPSILON_PX),
    (2100, 1400, float("inf")),
    (2100, 1400, -1),
    (True, 1400, INITIAL_EPSILON_PX),
])
def test_invalid_dimensions_and_epsilon_fail_closed(width, height, epsilon):
    with pytest.raises(ValueError):
        sight((100, 100), (600, 100), size=(width, height), epsilon=epsilon)


def test_complex_pb00_scene_is_repeatable_without_mutation():
    raw = tuple(from_pb00("complex"))
    pair = (105, 105), (805, 455)
    before = tuple(raw)
    result = sight(*pair, raw)
    assert result == sight(*pair, reversed(raw))
    assert tuple(raw) == before
    assert result.state in (SightState.CLEAR, SightState.BLOCKED)
    assert len(raw) == 200


def test_zero_segment_diagnostics_do_not_contain_geometry():
    result = sight((100, 100), (600, 100), [((350, 100), (350, 100))])
    assert result.ignored_zero_length == 1
    assert not hasattr(result, "occluder_id")


def test_neither_zero_wall_nor_endpoint_order_changes_result():
    seg = ((350, 0), (350, 350))
    zero = ((200, 100), (200, 100))
    r1 = sight((105, 105), (805, 105), [zero, seg])
    r2 = sight((105, 105), (805, 105), [tuple(reversed(seg)), zero])
    assert r1 == r2 == sight((105, 105), (805, 105), [seg, zero])


def _reference_sight(a, b, walls, epsilon=INITIAL_EPSILON_PX):
    """Exact test oracle: parametric intersection + cross-product distance.

    Production uses side signs and dot-product projection; this reference does
    not import its helpers. Fractions represent the supplied floats, not rounded
    decimal intentions. Analytic cases below also check the boundary contract.
    """
    from fractions import Fraction

    def point(p):
        return tuple(Fraction(v) for v in p)

    def sub(p, q):
        return p[0] - q[0], p[1] - q[1]

    def dot(u, v):
        return u[0] * v[0] + u[1] * v[1]

    def cross(u, v):
        return u[0] * v[1] - u[1] * v[0]

    def close(p, c, d):
        v, w = sub(d, c), sub(p, c)
        length, along = dot(v, v), dot(w, v)
        if along <= 0:
            distance = dot(w, w)
        elif along >= length:
            distance = dot(sub(p, d), sub(p, d))
        else:
            distance = cross(v, w) ** 2 / length
        return distance <= Fraction(epsilon) ** 2

    a, b = point(a), point(b)
    walls = [(point(c), point(d)) for c, d in walls if c != d]
    if any(close(a, c, d) for c, d in walls):
        return SightState.OBSERVER_ON_OBSTACLE
    if a == b:
        return SightState.CLEAR
    for c, d in walls:
        ray, wall, offset = sub(b, a), sub(d, c), sub(c, a)
        determinant = cross(ray, wall)
        if determinant:
            t = cross(offset, wall) / determinant
            u = cross(offset, ray) / determinant
            if 0 <= t <= 1 and 0 <= u <= 1:
                return SightState.BLOCKED
        if any((close(a, c, d), close(b, c, d), close(c, a, b), close(d, a, b))):
            return SightState.BLOCKED
    return SightState.CLEAR


@pytest.mark.parametrize("a,b,wall,expected", [
    # Old normalized projection lost the diagnostic when wall ends were reversed.
    ((2.69999992, 3.60000006), (1., 100.), ((0., 0.), (3., 4.)),
     SightState.OBSERVER_ON_OBSTACLE),
    # Old projection returned CLEAR even though exact distance was <= epsilon.
    ((6296.770485783843, 4107.197161628372),
     (2735.8377903889377, 69.77382087266687),
     ((6348.52441975517, 4144.710791430352),
      (5347.184211375355, 3418.89339211657)), SightState.OBSERVER_ON_OBSTACLE),
    # Old projection diagnosed a point actually outside the epsilon band.
    ((0.74999992, 1.00000006), (1., 100.), ((0., 0.), (3., 4.)), SightState.CLEAR),
])
def test_rounding_regressions_against_exact_input_values(a, b, wall, expected):
    assert _reference_sight(a, b, [wall]) is expected
    for segment in (wall, tuple(reversed(wall))):
        assert sight(a, b, [segment], size=(8192, 8192)).state is expected


@pytest.mark.parametrize("factor,near,far", [
    (0.5, SightState.OBSERVER_ON_OBSTACLE, SightState.BLOCKED),
    (1, SightState.OBSERVER_ON_OBSTACLE, SightState.BLOCKED),
    (2, SightState.CLEAR, SightState.CLEAR),
])
def test_exact_epsilon_boundary_without_translated_decimal_rounding(factor, near, far):
    delta = factor * INITIAL_EPSILON_PX
    wall = ((0., 0.), (0., 8.))
    assert sight((delta, 4.), (8., 4.), [wall]).state is near
    # Observer is far from the finite wall, but the ray passes it at delta.
    wall = ((3., 0.), (7., 0.))
    assert sight((1., delta), (9., delta), [wall]).state is far


def test_tiny_nonzero_wall_is_not_lost_to_squared_float_underflow():
    from math import nextafter
    wall = ((4., 0.), (4., nextafter(0., 1.)))
    assert wall[0] != wall[1]
    result = sight((1., 0.), (8., 0.), [wall])
    assert result.state is SightState.BLOCKED
    assert result.ignored_zero_length == 0


def test_shared_corner_and_many_walls_have_analytic_answer():
    clear = [((float(x), 500.), (float(x), 600.)) for x in range(1, 2001)]
    a, b = (0., 100.), (2100., 100.)
    assert sight(a, b, clear).state is SightState.CLEAR
    corner = [((1000., 100.), (1000., 300.)), ((1000., 100.), (1300., 100.))]
    walls = clear + corner + [tuple(reversed(corner[0]))]
    assert sight(a, b, walls).state is SightState.BLOCKED
    assert sight(b, a, reversed(walls)).state is SightState.BLOCKED


def test_deterministic_fraction_oracle_and_endpoint_order():
    from math import hypot, nextafter
    from random import Random

    rng = Random(3101)
    for index in range(1600):
        a, b, c, d = [tuple(rng.uniform(0, 8192) for _ in range(2)) for _ in range(4)]
        if index % 2 == 0:
            # Tilted walls and near-parallel rays at epsilon/2, epsilon, 2epsilon.
            dx, dy = d[0] - c[0], d[1] - c[1]
            length = hypot(dx, dy)
            delta = INITIAL_EPSILON_PX * rng.choice((0.5, 1., 2.))
            a = (c[0] + dx * 0.25 - dy / length * delta,
                 c[1] + dy * 0.25 + dx / length * delta)
            b = (c[0] + dx * 0.75 - dy / length * delta,
                 c[1] + dy * 0.75 + dx / length * delta)
        if index % 10 == 0:
            # Translate representable boundary-neighbor coordinates near 8192.
            a = (nextafter(8192., 0.), rng.uniform(0, 8192))
        if index % 25 == 0:
            b = a
        walls = [(c, d), ((0., 8192.), (0., 8192.))]
        for observer, target in ((a, b), (b, a)):
            expected = _reference_sight(observer, target, walls)
            for segments in (walls, [(d, c), walls[1]], list(reversed(walls))):
                result = sight(observer, target, iter(segments), size=(8192, 8192))
                assert result.state is expected, (index, observer, target, segments)
                assert result.ignored_zero_length == 1
