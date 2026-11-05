import asyncio
from dataclasses import replace
from threading import Event, get_ident

import pytest

import app.computation_runner as module
from app.computation_runner import ComputationRunner, ComputationState, PointQuery, RequestBudget
from app.lighting import LightState
from app.line_of_sight import PreparedGeometry, SightState
from .test_computation_context import capture

BUDGET = RequestBudget(100, 20, 100, 5., 5.)  # test policy, not production defaults
QUERIES = (PointQuery((25., 25.), (25., 50.)), PointQuery((25., 25.), (75., 50.)))


def run(coro):
    return asyncio.run(coro)


@pytest.mark.parametrize('changes', [dict(max_segments=-1), dict(max_queries=True), dict(max_sources=1.2),
    dict(preparation_seconds=0), dict(query_seconds=float('inf')), dict(query_seconds=True),
    dict(query_seconds=10**400), dict(preparation_seconds=1e308, query_seconds=1e308)])
def test_invalid_budgets_have_no_automatic_fallback(changes):
    with pytest.raises(ValueError):
        replace(BUDGET, **changes)


def test_results_are_separate_and_old_local_slot_is_cleared_on_invalidate():
    async def scenario():
        async with ComputationRunner(workers=1) as runner:
            result = await runner.run(capture(), QUERIES, budget=BUDGET)
            assert result.state is ComputationState.COMPLETE
            assert runner.latest is result
            assert result.answers[0].sight.state is SightState.CLEAR
            assert result.answers[0].light.state is LightState.LIT
            assert result.answers[1].sight.state is SightState.BLOCKED
            assert result.answers[1].light.state is LightState.UNLIT
            runner.invalidate()
            assert runner.latest is None
            # The previously returned immutable result is not a perpetual lease.
            assert result.state is ComputationState.COMPLETE
    run(scenario())


@pytest.mark.parametrize('changes', [dict(max_segments=0), dict(max_sources=0), dict(max_queries=0)])
def test_count_limits_are_checked_before_heavy_preparation(changes, monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError('must not prepare over-budget input')
    monkeypatch.setattr(module, 'build_context', forbidden)
    async def scenario():
        async with ComputationRunner(workers=1) as runner:
            result = await runner.run(capture(), QUERIES, budget=replace(BUDGET, **changes))
            assert result.state is ComputationState.INCOMPLETE and result.reason == 'count_budget'
            assert result.answers == () and runner.latest is None
    run(scenario())


@pytest.mark.parametrize('queries', [list(QUERIES), (None,), QUERIES + (PointQuery((25., 25.), (999., 0.)),),
    (PointQuery([25., 25.], (25., 50.)),)])
def test_invalid_or_late_bad_query_discards_all_partial_answers(queries):
    async def scenario():
        async with ComputationRunner(workers=1) as runner:
            result = await runner.run(capture(), queries, budget=BUDGET)
            assert result.state is ComputationState.UNAVAILABLE and result.answers == ()
            assert runner.latest is None
    run(scenario())


def test_bad_source_cannot_create_a_partially_positive_batch():
    from app.computation_context import SourceInput
    from app.lighting import Ambient
    async def scenario():
        async with ComputationRunner(workers=1) as runner:
            data = capture(sources=capture().sources + (SourceInput((50., 50.), 1.),), ambient=Ambient.FULL)
            result = await runner.run(data, QUERIES, budget=BUDGET)
            assert result.state is ComputationState.UNAVAILABLE and result.answers == ()
            assert runner.latest is None
    run(scenario())


class Clock:
    value = 0.
    def __call__(self):
        return self.value


def test_preparation_time_is_separate_and_discards_late_context(monkeypatch):
    clock, original = Clock(), module.build_context
    def delayed(*args, **kwargs):
        context = original(*args, **kwargs)
        clock.value = 6.
        return context
    monkeypatch.setattr(module, 'build_context', delayed)
    async def scenario():
        async with ComputationRunner(workers=1, clock=clock) as runner:
            result = await runner.run(capture(), QUERIES, budget=BUDGET)
            assert result.state is ComputationState.INCOMPLETE and result.reason == 'preparation_budget'
            assert result.preparation_seconds == 6. and result.query_seconds == 0.
            assert result.answers == () and runner.latest is None
    run(scenario())


def test_query_time_is_separate_and_checked_between_geometry_and_light(monkeypatch):
    clock, original = Clock(), PreparedGeometry.point_sight
    def delayed(self, observer, target):
        answer = original(self, observer, target)
        if observer != target:
            clock.value = 6.
        return answer
    monkeypatch.setattr(PreparedGeometry, 'point_sight', delayed)
    async def scenario():
        async with ComputationRunner(workers=1, clock=clock) as runner:
            result = await runner.run(capture(), QUERIES, budget=BUDGET)
            assert result.state is ComputationState.INCOMPLETE and result.reason == 'query_budget'
            assert result.preparation_seconds == 0. and result.query_seconds == 6.
            assert result.answers == () and runner.latest is None
    run(scenario())


def test_new_request_rejects_old_completion_even_with_same_revision_and_aba(monkeypatch):
    original = module.build_context
    release, held = Event(), Event()
    expected_version = original(capture(state_revision='old')).version
    async def scenario():
        entered = asyncio.Event()
        loop, owner = asyncio.get_running_loop(), get_ident()
        def blocked(data, **kwargs):
            assert get_ident() != owner
            if data.state_revision == 'old' and not held.is_set():
                held.set()
                loop.call_soon_threadsafe(entered.set)
                assert release.wait(10), 'test must release blocked atomic unit'
            return original(data, **kwargs)
        monkeypatch.setattr(module, 'build_context', blocked)
        async with ComputationRunner(workers=2) as runner:
            old = asyncio.create_task(runner.run(capture(state_revision='old'), QUERIES, budget=BUDGET))
            try:
                await asyncio.wait_for(entered.wait(), 10)
                newer = await runner.run(capture(state_revision='same-seq', segments=()), QUERIES, budget=BUDGET)
                assert newer.state is ComputationState.COMPLETE
                restored = await runner.run(capture(state_revision='old'), QUERIES, budget=BUDGET)
                assert restored.state is ComputationState.COMPLETE
                assert restored.generation > newer.generation
                assert restored.version == expected_version  # identical ABA content, distinct request epoch
                release.set()
                rejected = await old
                assert rejected.state is ComputationState.UNAVAILABLE and rejected.reason == 'stale'
                assert rejected.answers == () and runner.latest is restored
            finally:
                release.set()
                await old
    run(scenario())


def test_cancelled_old_awaiter_does_not_clear_new_result(monkeypatch):
    original, release = module.build_context, Event()
    async def scenario():
        entered, loop = asyncio.Event(), asyncio.get_running_loop()
        def blocked(data, **kwargs):
            if data.state_revision == 'old':
                loop.call_soon_threadsafe(entered.set)
                assert release.wait(10)
            return original(data, **kwargs)
        monkeypatch.setattr(module, 'build_context', blocked)
        async with ComputationRunner(workers=2) as runner:
            old = asyncio.create_task(runner.run(capture(state_revision='old'), QUERIES, budget=BUDGET))
            try:
                await asyncio.wait_for(entered.wait(), 10)
                new = await runner.run(capture(), QUERIES, budget=BUDGET)
                old.cancel()
                with pytest.raises(asyncio.CancelledError):
                    await old
                assert runner.latest is new
            finally:
                release.set()
    run(scenario())


def test_waiting_timeout_does_not_free_worker_capacity_or_queue_late_work(monkeypatch):
    original, release = module.build_context, Event()
    calls = []
    async def scenario():
        entered, loop = asyncio.Event(), asyncio.get_running_loop()
        def blocked(data, **kwargs):
            calls.append(get_ident())
            loop.call_soon_threadsafe(entered.set)
            assert release.wait(10)
            return original(data, **kwargs)
        monkeypatch.setattr(module, 'build_context', blocked)
        async with ComputationRunner(workers=1) as runner:
            task = asyncio.create_task(runner.run(capture(), QUERIES, budget=replace(BUDGET, preparation_seconds=.1, query_seconds=.1)))
            try:
                await asyncio.wait_for(entered.wait(), 10)
                # This coroutine can run while the atomic worker unit is blocked:
                # no heavy preparation is running in the event-loop thread.
                assert calls[0] != get_ident()
                timed_out = await task
                assert timed_out.state is ComputationState.INCOMPLETE and timed_out.reason == 'waiting_deadline'
                assert timed_out.answers == () and runner.latest is None
                for _ in range(10):
                    busy = await runner.run(capture(), QUERIES, budget=BUDGET)
                    assert busy.state is ComputationState.UNAVAILABLE and busy.reason == 'busy'
                assert len(calls) == 1  # timed-out work is still counted; no queued pile-up
            finally:
                release.set()
    run(scenario())


def test_cancellation_of_current_awaiter_invalidates_and_drains_worker(monkeypatch):
    original, release = module.build_context, Event()
    async def scenario():
        entered, loop = asyncio.Event(), asyncio.get_running_loop()
        def blocked(*args, **kwargs):
            loop.call_soon_threadsafe(entered.set)
            assert release.wait(10)
            return original(*args, **kwargs)
        monkeypatch.setattr(module, 'build_context', blocked)
        runner = ComputationRunner(workers=1)
        task = asyncio.create_task(runner.run(capture(), QUERIES, budget=BUDGET))
        try:
            await asyncio.wait_for(entered.wait(), 10)
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
            assert runner.latest is None
        finally:
            release.set()
            await runner.aclose()
        closed = await runner.run(capture(), QUERIES, budget=BUDGET)
        assert closed.state is ComputationState.UNAVAILABLE and closed.reason == 'closed'
    run(scenario())


def test_same_producer_revision_does_not_hide_changed_geometry_or_light():
    from app.computation_context import SourceInput
    async def scenario():
        async with ComputationRunner(workers=1) as runner:
            old = await runner.run(capture(state_revision='unchanged-seq'), QUERIES, budget=BUDGET)
            new = await runner.run(capture(state_revision='unchanged-seq', segments=(),
                sources=(SourceInput((75., 50.), 10.),)), QUERIES, budget=BUDGET)
            assert old.state is new.state is ComputationState.COMPLETE
            assert old.version.state_revision == new.version.state_revision
            assert old.version.content_digest != new.version.content_digest
            assert new.generation > old.generation and runner.latest is new
            assert old.answers[1].light.state is LightState.UNLIT
            assert new.answers[1].light.state is LightState.LIT
    run(scenario())


def test_unexpected_kernel_error_does_not_publish_or_leak_capacity(monkeypatch):
    original = module.build_context
    def broken(*args, **kwargs):
        raise ArithmeticError('synthetic kernel invariant failure')
    async def scenario():
        async with ComputationRunner(workers=1) as runner:
            assert (await runner.run(capture(), QUERIES, budget=BUDGET)).state is ComputationState.COMPLETE
            monkeypatch.setattr(module, 'build_context', broken)
            with pytest.raises(ArithmeticError):
                await runner.run(capture(), QUERIES, budget=BUDGET)
            assert runner.latest is None
            monkeypatch.setattr(module, 'build_context', original)
            recovered = await runner.run(capture(), QUERIES, budget=BUDGET)
            assert recovered.state is ComputationState.COMPLETE and runner.latest is recovered
    run(scenario())
