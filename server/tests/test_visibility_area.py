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


def area_size(contour):
    return abs(sum(a[0] * b[1] - b[0] * a[1]
                   for a, b in zip(contour, contour[1:] + contour[:1]))) / 2


@pytest.mark.parametrize("observer", [(50., 50.), (0., 50.), (0., 0.), (100., 100.)])
def test_scene_boundary_clips_but_is_not_an_obstacle(observer):
    from app.visibility_area import AreaState
    result = prepare().visibility_area(observer)
    assert result.state is AreaState.READY
    assert result.quality == "approximate_zero_width"
    assert set(result.contour).issuperset({(0, 0), (100, 0), (100, 100), (0, 100)})
    assert area_size(result.contour) == 10000
    assert result.point_sight((90., 90.)).state is SightState.CLEAR


def test_full_wall_analytic_half_rectangle_and_readonly_result():
    observer = [25., 50.]
    result = prepare([((50., 0.), (50., 100.))]).visibility_area(observer)
    observer[:] = [75., 50.]
    assert result.observer == (25., 50.)
    assert all(0 <= x <= 50 and 0 <= y <= 100 for x, y in result.contour)
    assert area_size(result.contour) == 5000
    assert result.point_sight((75., 50.)).state is SightState.BLOCKED
    with pytest.raises(FrozenInstanceError):
        result.contour = ()


@pytest.mark.parametrize("offset", [0., 0.5e-7, 1e-7])
def test_observer_near_wall_returns_diagnostic_not_a_normal_polygon(offset):
    from app.visibility_area import AreaState
    result = prepare([((0., 0.), (100., 0.)), ((1., 1.), (1., 1.))]).visibility_area((50., offset))
    assert result.state is AreaState.OBSERVER_ON_OBSTACLE
    assert result.contour is None and result.direction_count == 0
    assert result.ignored_zero_length == 1
    assert result.point_sight((50., 50.)).state is SightState.OBSERVER_ON_OBSTACLE


def test_endpoint_contact_retains_radial_retrace_not_false_full_scene_boundary():
    result = prepare([((50., 50.), (75., 50.))]).visibility_area((25., 50.))
    # The isolated event ray stops at the near endpoint, while both angular
    # limits reach the scene boundary. A simple-polygon claim would be false.
    assert result.contour[:3] == ((100, 50), (50, 50), (100, 50))
    assert result.point_sight((80., 50.)).state is SightState.BLOCKED


def test_very_narrow_gap_and_subnormal_events_are_not_angularly_merged():
    from math import nextafter
    bottom, top = 50. - 2e-7, 50. + 2e-7
    walls = [((50., 0.), (50., bottom)), ((50., top), (50., 100.)),
             ((80., 0.), (80., nextafter(0., 1.)))]
    result = prepare(walls).visibility_area((25., 50.))
    assert result.point_sight((75., 50.)).state is SightState.CLEAR
    assert max(x for x, _ in result.contour) == 100
    assert result.direction_count == 10  # distinct endpoints plus four corners


def inside(point, polygon):
    # Independent test-only even/odd crossing; never exported by production API.
    x, y = point
    value = False
    for a, b in zip(polygon, polygon[1:] + polygon[:1]):
        if (a[1] > y) != (b[1] > y):
            hit = a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1])
            if x < hit:
                value = not value
    return value


def test_independent_random_interior_probes_and_segment_order_invariance():
    import random
    from .test_los_geometry import _reference_sight
    rng = random.Random(714030)
    for _ in range(15):
        walls = [((rng.uniform(0, 100), rng.uniform(0, 100)),
                  (rng.uniform(0, 100), rng.uniform(0, 100))) for _ in range(12)]
        prepared = prepare(walls)
        observer = rng.uniform(0, 100), rng.uniform(0, 100)
        result = prepared.visibility_area(observer)
        reversed_result = prepare([wall[::-1] for wall in walls[::-1]] + walls).visibility_area(observer)
        assert result.contour == reversed_result.contour
        for _ in range(30):
            target = rng.uniform(0, 100), rng.uniform(0, 100)
            exact = prepared.point_sight(observer, target)
            assert result.point_sight(target) == exact
            assert exact.state is _reference_sight(observer, target, walls)
            # Continuous random probes are far from the epsilon boundary;
            # dedicated tests below explicitly demonstrate that exception.
            assert inside(tuple(map(F, target)), result.contour) == (exact.state is SightState.CLEAR)


def test_approximate_contour_is_not_the_epsilon_oracle():
    # Raw ray misses the wall by epsilon/2. The contour includes the target,
    # but the *only* production point query must still report BLOCKED.
    result = prepare([((50., 50.), (50., 80.))]).visibility_area((25., 50. - 0.5e-7))
    target = (75., 50. - 0.5e-7)
    assert inside(tuple(map(F, target)), result.contour)
    assert result.point_sight(target).state is SightState.BLOCKED
    assert result.quality == "approximate_zero_width"


@pytest.mark.parametrize("walls", [
    [((10., 10.), (90., 90.)), ((10., 90.), (90., 10.))],
    [((50., 0.), (50., 50.)), ((50., 50.), (90., 50.))],
    [((10., 50.), (60., 50.)), ((30., 50.), (80., 50.))],
    [((50., 0.), (50., 1e-300))],
])
def test_crossings_t_junctions_overlaps_and_short_segments(walls):
    result = prepare(walls).visibility_area((5., 45.))
    assert result.contour and area_size(result.contour) > 0
    assert all(0 <= x <= 100 and 0 <= y <= 100 for x, y in result.contour)


def test_nearest_bvh_matches_independent_linear_intersection_oracle():
    import random
    from app.visibility_area import _nearest
    rng = random.Random(302)
    walls = [((rng.randrange(1, 99), rng.randrange(1, 99)),
              (rng.randrange(1, 99), rng.randrange(1, 99))) for _ in range(120)]
    prepared = prepare(walls)
    origin = (F(0), F(0))
    for _ in range(150):
        dx, dy = rng.randrange(1, 10000), rng.randrange(1, 10000)
        hits = [min(F(100, dx), F(100, dy))]
        for (ax, ay), (bx, by) in walls:
            # Independent determinant equations for the ray/segment pair.
            determinant = dx * (ay - by) + dy * (bx - ax)
            if not determinant:
                continue
            t = F(ax * (ay - by) + ay * (bx - ax), determinant)
            u = F(dx * ay - dy * ax, determinant)
            if t >= 0 and 0 <= u <= 1:
                hits.append(t)
        assert _nearest(prepared, origin, (dx, dy)).distance == min(hits)


@pytest.mark.parametrize("observer", [(float('nan'), 0), (-1, 0), (101, 0), (True, 0), (1,)])
def test_invalid_observer_is_rejected_before_contour(observer):
    with pytest.raises(ValueError):
        prepare().visibility_area(observer)


@pytest.mark.parametrize("name", ["empty", "straight", "corner", "door-closed", "door-open", "door-locked",
                                  "window-opening", "gm-layer", "manual-fog", "complex"])
def test_pb00_scenes_compare_point_queries_to_independent_fraction_reference(name):
    from .fixtures.los_baseline import scenes
    from .test_los_geometry import _reference_sight
    data = scenes()[name]
    # Window optics remain OPEN. Test BOTH hypothetical opaque inputs without
    # adding a production window adapter or choosing either policy.
    for window_opaque in (False, True):
        walls = [((w['x1'], w['y1']), (w['x2'], w['y2'])) for w in data['walls']
                 if (w['kind'] == 'wall' or (w['kind'] == 'door' and w['door_state'] != 'open')
                     or (w['kind'] == 'window' and window_opaque))]
        result = prepare(walls, (data['width'], data['height'])).visibility_area((105., 105.))
        for target in [(805., 105.), (20., 20.), (2000., 1300.), (350., 105.)]:
            assert result.point_sight(target).state is _reference_sight((105., 105.), target, walls)


@pytest.mark.parametrize("state", ["open", "closed", "locked"])
@pytest.mark.parametrize("flag", [False, True])
def test_existing_scene_door_adapter_needs_no_new_optics_or_data(state, flag):
    from app.models import Scene, Wall
    from app.scene_sight import prepare_scene_geometry
    scene = Scene(id='synthetic', width=100, height=100)
    wall = Wall(scene_id='synthetic', x1=50., y1=0., x2=50., y2=100.,
                kind='door', door_state=state, blocks_sight=flag)
    prepared = PreparedVisibilityGeometry(prepare_scene_geometry(scene, [wall]))
    result = prepared.visibility_area((25., 50.))
    assert area_size(result.contour) == (10000 if state == 'open' else 5000)
    assert result.point_sight((75., 50.)).state is (SightState.CLEAR if state == 'open' else SightState.BLOCKED)


def test_fractional_nearly_parallel_intersections_near_8192_are_order_invariant():
    walls = [((0.125, 0.125), (8191.875, 8191.875 - 1e-7)),
             ((0.125, 0.125 + 1e-7), (8191.875, 8191.875 - 2e-7))]
    prepared = prepare(walls, (8192., 8192.))
    assert prepared.intersection_point_count == 1
    result = prepared.visibility_area((0., 8192.))
    other = prepare([w[::-1] for w in walls[::-1]], (8192., 8192.)).visibility_area((0., 8192.))
    assert result.contour == other.contour
    for point, state in [((8192., 0.), SightState.BLOCKED), ((0., 0.), SightState.CLEAR),
                         ((8192., 8192.), SightState.CLEAR)]:
        assert result.point_sight(point).state is state


def test_exact_contour_scales_without_a_new_grid_or_angle_tolerance():
    walls = [((30., 20.), (70., 80.)), ((30., 80.), (70., 20.)),
             ((75., 0.), (75., 30.)), ((75., 31.), (75., 100.))]
    small = prepare(walls).visibility_area((10., 50.))
    factor = 64
    large_walls = [tuple(tuple(v * factor for v in p) for p in w) for w in walls]
    large = prepare(large_walls, (6400., 6400.)).visibility_area((640., 3200.))
    assert large.direction_count == small.direction_count
    assert large.contour == tuple((x * factor, y * factor) for x, y in small.contour)


def test_observer_two_epsilon_from_wall_is_usable_and_keeps_zero_diagnostics():
    from app.visibility_area import AreaState
    result = prepare([((0., 0.), (100., 0.)), ((20., 20.), (20., 20.))]).visibility_area((50., 2e-7))
    assert result.state is AreaState.READY
    assert result.contour is not None
    assert result.ignored_zero_length == result.point_sight((50., 50.)).ignored_zero_length == 1


def test_one_prepared_snapshot_can_serve_both_sides_without_state_leakage():
    prepared = prepare([((50., 0.), (50., 100.))])
    events = prepared.event_points
    left = prepared.visibility_area((25., 50.))
    right = prepared.visibility_area((75., 50.))
    assert area_size(left.contour) == area_size(right.contour) == 5000
    assert max(x for x, _ in left.contour) == min(x for x, _ in right.contour) == 50
    assert prepared.event_points is events
    assert prepared.visibility_area((25., 50.)) == left
    assert left.point_sight((25., 50.)).state is SightState.CLEAR
    assert right.point_sight((25., 50.)).state is SightState.BLOCKED


def test_many_shared_vertex_segments_do_not_drop_pair_or_corner_events():
    walls = [((10., float(i)), (90., float(100 - i))) for i in range(30, 70)]
    prepared = prepare(walls)
    assert prepared.candidate_pair_count == 40 * 39 // 2
    assert prepared.intersection_point_count == 1
    assert (F(50), F(50)) in prepared.event_points
    result = prepared.visibility_area((5., 50.))
    assert result.point_sight((95., 50.)).state is SightState.BLOCKED
