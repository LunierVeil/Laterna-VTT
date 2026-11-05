from dataclasses import FrozenInstanceError, replace
import asyncio

import pytest

from app.computation_context import ContextInput, SourceInput, build_context
from app.lighting import Ambient, LightState
from app.line_of_sight import SightState


def capture(**changes):
    data = ContextInput('synthetic-scene', 'capture-1', 100., 100.,
                        (((50., 0.), (50., 100.)),), (SourceInput((25., 50.), 100.),), Ambient.NONE)
    return replace(data, **changes)


def test_context_has_one_bound_geometry_and_separate_point_results():
    context = build_context(capture())
    assert context.lighting.point_sight((75., 10.), (75., 50.)).state is SightState.CLEAR
    assert context.lighting.point_light((75., 50.)).state is LightState.UNLIT
    assert context.geometry.point_sight((25., 50.), (75., 50.)).state is SightState.BLOCKED
    with pytest.raises(FrozenInstanceError):
        context.version = None
    with pytest.raises(FrozenInstanceError):
        context.version.state_revision = 'changed'


def test_versions_are_values_not_python_identity():
    first, second = build_context(capture()), build_context(capture())
    assert first is not second and first.geometry is not second.geometry
    assert first.version == second.version
    assert len(first.version.content_digest) == 64


@pytest.mark.parametrize('change', [
    {'segments': ()}, {'sources': (SourceInput((75., 50.), 100.),)},
    {'sources': (SourceInput((25., 50.), 99.),)}, {'ambient': Ambient.FULL},
    {'epsilon': 2e-7}, {'width': 101.}, {'height': 101.},
    {'scope_key': 'other-scene'}, {'state_revision': 'capture-2'},
    {'segments': (((50., 0.), (50., 100.)), ((1., 1.), (1., 1.)))},
])
def test_content_changes_are_detected_even_if_producer_revision_did_not_change(change):
    assert build_context(capture(**change)).version != build_context(capture()).version


@pytest.mark.parametrize('change', [
    {'segments': []}, {'segments': ([(50., 0.), (50., 100.)],)},
    {'segments': (([50., 0.], (50., 100.)),)}, {'sources': []},
    {'sources': (SourceInput([25., 50.], 100.),)}, {'sources': (SourceInput((50., 50.), 10.),)},
    {'sources': (SourceInput((25., 50.), 0.),)}, {'ambient': None}, {'state_revision': ''},
])
def test_mutable_or_invalid_capture_never_builds_a_context(change):
    with pytest.raises((ValueError, TypeError)):
        build_context(capture(**change))


def test_checkpoint_can_abort_before_geometry_or_hash_finishes():
    calls = 0
    def checkpoint():
        nonlocal calls
        calls += 1
        if calls == 4:
            raise RuntimeError('synthetic cancellation')
    with pytest.raises(RuntimeError, match='cancellation'):
        build_context(capture(), checkpoint=checkpoint)


def test_direct_preparation_inside_event_loop_is_forbidden():
    async def run():
        with pytest.raises(RuntimeError, match='outside the asyncio'):
            build_context(capture())
    asyncio.run(run())
