"""Isolated lighting with synthetic coordinates; no user data or runtime caller."""
from dataclasses import FrozenInstanceError
from fractions import Fraction
from math import inf, nan, nextafter

import pytest

from app.line_of_sight import PreparedGeometry, SightState
from app.lighting import Ambient, LightSource, LightState, LightingField, SourceState


def geometry(walls=(), size=(100., 100.)):
    return PreparedGeometry(walls, width=size[0], height=size[1])


def test_empty_scene_closed_radius_and_source_point():
    source = LightSource(geometry(), (20., 20.), 5.)
    assert source.state is SourceState.READY
    assert source.point_light((20., 20.)).state is LightState.LIT
    assert source.point_light((23., 24.)).state is LightState.LIT
    assert source.point_light((23., nextafter(24., inf))).state is LightState.UNLIT
    assert source.point_light((23., nextafter(24., 0.))).state is LightState.LIT


def test_torch_in_room_cannot_reach_through_its_wall_or_corner():
    source = LightSource(geometry([((50., 20.), (50., 80.))]), (25., 50.), 100.)
    assert source.point_light((40., 50.)).state is LightState.LIT
    assert source.point_light((75., 50.)).state is LightState.UNLIT
    assert source.point_light((75., 100.)).state is LightState.UNLIT  # touches (50,75)
    assert source.point_light((75., 0.)).state is LightState.UNLIT
    assert source.point_light((50., 20.)).state is LightState.UNLIT  # exact endpoint


@pytest.mark.parametrize("offset", [0., 0.5e-7, 1e-7])
def test_source_on_or_within_epsilon_of_wall_is_explicitly_unavailable(offset):
    source = LightSource(geometry([((0., 0.), (100., 0.))]), (50., offset), 1.)
    assert source.state is SourceState.ON_OBSTACLE
    assert source.point_light((50., 50.)).state is LightState.UNAVAILABLE  # even outside radius
    assert source.point_light(source.position).state is LightState.UNAVAILABLE


def test_source_two_epsilon_away_is_ready_and_uses_exact_los():
    source = LightSource(geometry([((0., 0.), (100., 0.))]), (50., 2e-7), 10.)
    assert source.state is SourceState.READY
    assert source.point_light((50., 1.)).state is LightState.LIT
    assert source.point_light((50., 0.5e-7)).state is LightState.UNLIT


@pytest.mark.parametrize("radius", [0., -0., -1., nan, inf, -inf, True, None, "10", 10 ** 400])
def test_invalid_radius_is_error_not_an_ignored_source(radius):
    with pytest.raises(ValueError):
        LightSource(geometry(), (20., 20.), radius)


@pytest.mark.parametrize("position", [(nan, 0), (inf, 0), (0, -inf), (-1, 0), (101, 0),
                                      (True, 0), (0, "1"), (1,), None, (10 ** 400, 0)])
def test_invalid_source_position_is_error(position):
    with pytest.raises(ValueError):
        LightSource(geometry(), position, 10.)


@pytest.mark.parametrize("position", [(nan, 0), (inf, 0), (-1, 0), (101, 0), (True, 0), None, (1,)])
def test_invalid_target_is_rejected_even_outside_radius(position):
    source = LightSource(geometry(), (20., 20.), 1.)
    with pytest.raises(ValueError):
        source.point_light(position)


def test_radius_math_does_not_overflow_or_underflow_in_binary64():
    tiny = nextafter(0., 1.)
    source = LightSource(geometry(), (0., 0.), tiny)
    assert source.point_light((tiny, 0.)).state is LightState.LIT
    assert source.point_light((tiny * 2, 0.)).state is LightState.UNLIT
    assert LightSource(geometry(), (0., 0.), 1e308).point_light((100., 100.)).state is LightState.LIT


def test_radius_subtraction_happens_as_fractions_not_rounded_float_difference():
    source = LightSource(geometry(size=(8192., 8192.)), (0.1, 0.1), 8191.)
    target = (8191.1, 0.1)
    actual = abs(Fraction(target[0]) - Fraction(source.position[0]))
    expected = LightState.LIT if actual <= Fraction(source.radius) else LightState.UNLIT
    assert source.point_light(target).state is expected


def test_source_copies_mutable_position_and_preserves_zero_wall_diagnostics():
    position = [20., 20.]
    source = LightSource(geometry([((1., 1.), (1., 1.))]), position, 10.)
    position[:] = [90., 90.]
    assert source.position == (20., 20.)
    assert source.point_light((21., 20.)).ignored_zero_length == 1
    assert source.point_light((90., 90.)).ignored_zero_length == 1
    with pytest.raises(FrozenInstanceError):
        source.radius = 90.
    with pytest.raises(FrozenInstanceError):
        source.state = SourceState.ON_OBSTACLE


def test_approximate_geometry_is_not_an_accepted_source_of_truth():
    from app.visibility_area import PreparedVisibilityGeometry
    with pytest.raises(TypeError, match="exact PreparedGeometry"):
        LightSource(PreparedVisibilityGeometry(geometry()), (20., 20.), 10.)


def test_out_of_radius_skips_los_without_skipping_target_validation(monkeypatch):
    source = LightSource(geometry(), (20., 20.), 5.)
    def forbidden(*args):
        raise AssertionError("out-of-radius must not need a ray")
    monkeypatch.setattr(PreparedGeometry, 'point_sight', forbidden)
    assert source.point_light((90., 90.)).state is LightState.UNLIT
    with pytest.raises(ValueError):
        source.point_light((101., 0.))


@pytest.mark.parametrize("ambient,expected", [(Ambient.NONE, LightState.UNLIT), (Ambient.FULL, LightState.LIT)])
def test_explicit_ambient_and_empty_source_collection(ambient, expected):
    field = LightingField(geometry(), [], ambient=ambient)
    assert field.point_light((50., 50.)).state is expected


@pytest.mark.parametrize("ambient", [None, True, False, "", "auto", "FULL", 0, []])
def test_no_ambient_default_or_coercion(ambient):
    with pytest.raises(ValueError, match="explicitly"):
        LightingField(geometry(), [], ambient=ambient)


def test_ambient_is_required_keyword_argument():
    with pytest.raises(TypeError):
        LightingField(geometry(), [])


def test_two_sources_union_includes_overlap_without_double_brightness():
    g = geometry()
    first, second = LightSource(g, (30., 50.), 25.), LightSource(g, (70., 50.), 25.)
    field = LightingField(g, [first, second], ambient=Ambient.NONE)
    for point in [(10., 50.), (30., 50.), (50., 50.), (70., 50.), (90., 50.)]:
        assert field.point_light(point).state is LightState.LIT
    assert field.point_light((50., 80.)).state is LightState.UNLIT
    reverse = LightingField(g, [second, first, first], ambient=Ambient.NONE)
    for x in range(0, 101, 10):
        assert reverse.point_light((x, 50.)) == field.point_light((x, 50.))


@pytest.mark.parametrize("ambient", [Ambient.NONE, Ambient.FULL])
@pytest.mark.parametrize("reverse", [False, True])
def test_unavailable_source_invalidates_entire_field_even_after_a_good_lamp(ambient, reverse, monkeypatch):
    g = geometry([((0., 0.), (100., 0.)), ((1., 1.), (1., 1.))])
    good, bad = LightSource(g, (50., 50.), 100.), LightSource(g, (50., 0.), 1.)
    sources = [bad, good] if reverse else [good, bad]
    field = LightingField(g, sources, ambient=ambient)
    assert field.unavailable_source_indices == ((0,) if reverse else (1,))
    def forbidden(*args):
        raise AssertionError("invalid field must not evaluate a partially positive union")
    monkeypatch.setattr(LightSource, '_point_light', forbidden)
    assert field.point_light((50., 50.)).state is LightState.UNAVAILABLE
    assert field.point_light((50., 50.)).ignored_zero_length == 1


@pytest.mark.parametrize("state", ["open", "closed", "locked"])
@pytest.mark.parametrize("flag", [False, True])
def test_torch_and_existing_door_adapter(state, flag):
    from app.models import Scene, Wall
    from app.scene_sight import prepare_scene_geometry
    scene = Scene(id='lighting-synthetic', width=100, height=100)
    wall = Wall(scene_id=scene.id, x1=50., y1=0., x2=50., y2=100.,
                kind='door', door_state=state, blocks_sight=flag)
    g = prepare_scene_geometry(scene, [wall])
    field = LightingField(g, [LightSource(g, (25., 50.), 100.)], ambient=Ambient.NONE)
    assert field.point_light((75., 50.)).state is (LightState.LIT if state == 'open' else LightState.UNLIT)


def test_geometry_and_light_are_separate_not_a_final_visibility_answer():
    g = geometry([((50., 0.), (50., 100.))])
    field = LightingField(g, [LightSource(g, (75., 50.), 100.)], ambient=Ambient.NONE)
    assert field.point_light((90., 50.)).state is LightState.LIT
    assert field.point_sight((25., 50.), (90., 50.)).state is SightState.BLOCKED
    assert field.point_light((20., 50.)).state is LightState.UNLIT
    assert field.point_sight((25., 50.), (20., 50.)).state is SightState.CLEAR
    full = LightingField(g, [], ambient=Ambient.FULL)
    assert full.point_light((50., 50.)).state is LightState.LIT
    assert full.point_sight((25., 50.), (50., 50.)).state is SightState.BLOCKED


def test_different_geometry_even_with_equal_coordinates_is_rejected():
    first, second = geometry(), geometry()
    with pytest.raises(ValueError, match="same exact geometry"):
        LightingField(first, [LightSource(second, (20., 20.), 10.)], ambient=Ambient.FULL)


@pytest.mark.parametrize("sources", [None, [None], [object()], [dict(position=(20., 20.), radius=10.)]])
def test_malformed_source_collection_is_error_even_with_full_ambient(sources):
    with pytest.raises(TypeError):
        LightingField(geometry(), sources, ambient=Ambient.FULL)


def test_iterable_failure_cannot_produce_partial_field():
    g = geometry()
    def broken():
        yield LightSource(g, (20., 20.), 100.)
        raise RuntimeError("synthetic iterator failure")
    with pytest.raises(RuntimeError, match="synthetic"):
        LightingField(g, broken(), ambient=Ambient.FULL)


def test_field_copies_source_collection_and_is_immutable():
    g = geometry()
    inputs = [LightSource(g, (20., 20.), 10.)]
    field = LightingField(g, inputs, ambient='none')
    inputs.clear()
    assert field.sources and field.point_light((20., 20.)).state is LightState.LIT
    assert field.ambient is Ambient.NONE
    with pytest.raises(FrozenInstanceError):
        field.ambient = Ambient.FULL
    with pytest.raises(TypeError):
        field.sources[0] = None


@pytest.mark.parametrize("ambient", [Ambient.NONE, Ambient.FULL])
def test_bad_target_is_error_even_when_ambient_would_short_circuit(ambient):
    field = LightingField(geometry(), [], ambient=ambient)
    with pytest.raises(ValueError):
        field.point_light((nan, 0.))
    with pytest.raises(ValueError):
        field.point_light((101., 0.))


def test_zero_length_diagnostic_is_not_multiplied_by_sources_or_ambient():
    g = geometry([((0., 0.), (0., 0.)), ((1., 1.), (1., 1.))])
    sources = [LightSource(g, (20., 20.), 10.) for _ in range(4)]
    for ambient in Ambient:
        field = LightingField(g, sources, ambient=ambient)
        for target in ((20., 20.), (90., 90.)):
            assert field.point_light(target).ignored_zero_length == 2


def reference_lit(sources, target, walls):
    from .test_los_geometry import _reference_sight
    return any(sum((Fraction(t) - Fraction(p)) ** 2 for t, p in zip(target, source.position))
               <= Fraction(source.radius) ** 2
               and _reference_sight(source.position, target, walls) is SightState.CLEAR
               for source in sources)


def test_random_fields_agree_with_independent_fraction_distance_and_los():
    from random import Random
    rng = Random(1012026)
    for _ in range(8):
        walls = [((rng.uniform(0, 256), rng.uniform(0, 256)),
                  (rng.uniform(0, 256), rng.uniform(0, 256))) for _ in range(20)]
        g = geometry(walls, (256., 256.))
        sources = [LightSource(g, position, radius) for position, radius in
                   [((10., 20.), 80.), ((100., 120.), 150.), ((230., 230.), 200.)]]
        assert all(s.state is SourceState.READY for s in sources)
        for ambient in Ambient:
            field = LightingField(g, sources, ambient=ambient)
            for _ in range(40):
                target = rng.uniform(0, 256), rng.uniform(0, 256)
                lit = ambient is Ambient.FULL or reference_lit(sources, target, walls)
                assert field.point_light(target).state is (LightState.LIT if lit else LightState.UNLIT)


@pytest.mark.parametrize("name", ["empty", "straight", "corner", "door-closed", "door-open", "door-locked",
                                  "window-opening", "gm-layer", "manual-fog", "complex"])
def test_all_pb00_scenes_against_fraction_oracle_without_choosing_window_optics(name):
    from .fixtures.los_baseline import scenes
    data = scenes()[name]
    for opaque_window in (False, True):
        # Hypothetical test-only opaque input, not a window adapter. W3 OPEN.
        walls = [((w['x1'], w['y1']), (w['x2'], w['y2'])) for w in data['walls']
                 if w['kind'] == 'wall' or (w['kind'] == 'door' and w['door_state'] != 'open')
                 or (w['kind'] == 'window' and opaque_window)]
        g = geometry(walls, (data['width'], data['height']))
        sources = [LightSource(g, (105., 105.), 700.), LightSource(g, (805., 175.), 700.)]
        assert all(s.state is SourceState.READY for s in sources)
        field = LightingField(g, sources, ambient=Ambient.NONE)
        for target in [(805., 105.), (105., 105.), (350., 105.), (2000., 1300.)]:
            lit = reference_lit(sources, target, walls)
            assert field.point_light(target).state is (LightState.LIT if lit else LightState.UNLIT)


def test_exact_endpoint_contact_blocks_light_but_real_gap_passes():
    source = LightSource(geometry([((50., 20.), (50., 80.))]), (25., 50.), 100.)
    assert source.point_light((62.5, 5.)).state is LightState.UNLIT
    assert source.point_light((62.5, 4.999)).state is LightState.LIT


def test_new_geometry_and_moved_source_need_new_bindings_not_mutation():
    closed, opened = geometry([((50., 0.), (50., 100.))]), geometry()
    old = LightingField(closed, [LightSource(closed, (25., 50.), 100.)], ambient=Ambient.NONE)
    new = LightingField(opened, [LightSource(opened, (25., 50.), 100.)], ambient=Ambient.NONE)
    assert new.point_light((75., 50.)).state is LightState.LIT
    assert old.point_light((75., 50.)).state is LightState.UNLIT
    with pytest.raises(ValueError):
        LightingField(opened, old.sources, ambient=Ambient.NONE)
    moved = LightingField(opened, [LightSource(opened, (75., 50.), 5.)], ambient=Ambient.NONE)
    assert moved.point_light((25., 50.)).state is LightState.UNLIT
    assert new.point_light((25., 50.)).state is LightState.LIT


def test_late_malformed_source_is_not_ignored_after_a_lit_source():
    g = geometry()
    with pytest.raises(TypeError):
        LightingField(g, [LightSource(g, (20., 20.), 100.), None], ambient=Ambient.FULL)


def test_query_position_contract_matches_existing_exact_geometry_for_bad_inputs():
    from decimal import Decimal
    g = geometry()
    source = LightSource(g, (20., 20.), 1.)
    field = LightingField(g, [source], ambient=Ambient.FULL)
    for target in [[], [1], (0, inf), (nan, 0), (-1, 0), (101, 0), (False, 0),
                   (Decimal('1'), 0), (10 ** 400, 0), {'x': 1, 'y': 2}]:
        with pytest.raises(ValueError):
            g.point_sight((20., 20.), target)
        with pytest.raises(ValueError):
            field.point_light(target)
        with pytest.raises(ValueError):
            source.point_light(target)


def test_approximate_contour_cannot_create_a_lit_point_near_wall_endpoint():
    from app.visibility_area import PreparedVisibilityGeometry
    g = geometry([((50., 50.), (50., 80.))])
    position = (25., 50. - 0.5e-7)
    area = PreparedVisibilityGeometry(g).visibility_area(position)
    source = LightSource(g, position, 100.)
    target = (75., 50. - 0.5e-7)
    assert area.quality == 'approximate_zero_width'
    assert area.point_sight(target).state is SightState.BLOCKED
    assert source.point_light(target).state is LightState.UNLIT
