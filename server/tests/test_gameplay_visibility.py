from dataclasses import replace
import asyncio
import threading

import pytest

from app import gameplay_visibility as los
from app.roles import Actor


def scene(door='closed'):
    tokens = (los.Target('pc-a', 100., 200., 'tokens', 'a', 'char-a', 'dnd5e', 'a'),
              los.Target('pc-b', 400., 400., 'tokens', 'b', 'char-b', 'dnd5e', 'b'),
              los.Target('npc', 400., 200., 'tokens', None, 'mob', 'mob', None))
    walls = (los.Obstacle('scene', 250., 0., 250., 100., 'wall', None, True),
             los.Obstacle('scene', 250., 100., 250., 300., 'door', door, True),
             los.Obstacle('scene', 250., 300., 250., 600., 'wall', None, True))
    return los.Capture('scene', 'campaign', 800, 600, 0, '[]', tokens, walls, 'stamp', False)


@pytest.mark.parametrize('state,visible', [('open', True), ('closed', False), ('locked', False)])
def test_each_player_has_exact_personal_projection(state, visible):
    frame = scene(state)
    a = los.calculate(frame, Actor('a', 'A'))
    b = los.calculate(frame, Actor('b', 'B'))
    assert ('npc' in a.ids) is visible
    assert 'npc' in b.ids
    assert 'pc-a' in a.ids and 'pc-b' in b.ids


@pytest.mark.parametrize('mutation', ['missing', 'multiple', 'wrong_owner', 'mob', 'on_wall', 'unknown_kind', 'budget'])
def test_ambiguous_or_invalid_inputs_keep_only_own_tokens(mutation):
    frame = scene('open')
    pc = frame.tokens[0]
    if mutation == 'missing':
        frame = replace(frame, tokens=(replace(pc, character_id=None, system=None), *frame.tokens[1:]))
    elif mutation == 'multiple':
        frame = replace(frame, tokens=(*frame.tokens, replace(pc, id='pc-a2')))
    elif mutation == 'wrong_owner':
        frame = replace(frame, tokens=(replace(pc, character_owner='b'), *frame.tokens[1:]))
    elif mutation == 'mob':
        frame = replace(frame, tokens=(replace(pc, system='mob'), *frame.tokens[1:]))
    elif mutation == 'on_wall':
        frame = replace(frame, tokens=(replace(pc, x=250., y=50.), *frame.tokens[1:]))
    elif mutation == 'unknown_kind':
        frame = replace(frame, walls=(replace(frame.walls[0], kind='future_window'), *frame.walls[1:]))
    else:
        frame = replace(frame, over_budget=True)
    result = los.calculate(frame, Actor('a', 'A'))
    assert 'pc-a' in result.ids
    assert 'npc' not in result.ids and 'pc-b' not in result.ids
    assert result.status != 'complete'


def test_gm_layer_and_manual_fog_are_not_overridden_by_clear():
    frame = scene('open')
    gm = replace(frame.tokens[2], layer='gm')
    assert 'npc' not in los.calculate(replace(frame, tokens=(*frame.tokens[:2], gm)), Actor('a', 'A')).ids
    covered = replace(frame, fog_json='[{"id":"f","x":350,"y":150,"w":100,"h":100}]')
    assert 'npc' not in los.calculate(covered, Actor('a', 'A')).ids


def test_preview_requires_both_current_and_destination_visibility():
    frame = scene('closed')
    assert not los.calculate(frame, Actor('a', 'A'), ('npc', 150., 200.)).destination
    assert los.calculate(frame, Actor('b', 'B'), ('npc', 450., 200.)).destination
    assert not los.calculate(frame, Actor('b', 'B'), ('npc', 150., 200.)).destination


def test_timeout_does_not_free_capacity_until_actual_worker_completion(monkeypatch):
    entered, release = threading.Event(), threading.Event()
    original = los.calculate
    def held(*args):
        entered.set()
        assert release.wait(2)
        return original(*args)
    monkeypatch.setattr(los, 'calculate', held)
    monkeypatch.setattr(los, 'CPU_SECONDS', .01)
    async def check():
        try:
            result = await los.calculate_bounded(scene('open'), Actor('a', 'A'))
            assert entered.is_set() and result.status == 'timeout' and result.ids == {'pc-a'}
            busy = await los.calculate_bounded(scene('open'), Actor('b', 'B'))
            assert busy.status == 'busy' and busy.ids == {'pc-b'}
        finally:
            release.set()
            acquired = await asyncio.to_thread(los._capacity.acquire, True, 2)
            assert acquired
            los._capacity.release()
    asyncio.run(check())
