"""Isolated lighting with synthetic coordinates; no user data or runtime caller."""
from dataclasses import FrozenInstanceError
from fractions import Fraction
from math import inf, nan, nextafter

import pytest

from app.line_of_sight import PreparedGeometry, SightState
from app.lighting import LightSource, LightState, SourceState


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
