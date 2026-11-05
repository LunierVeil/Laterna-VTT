"""PB-01d-3 experimental bounded worker + local result acceptance, no runtime wiring.

Cooperative CPU cancellation, bounded admission and an await timeout (not hard
thread termination or a wall-clock SLA). The owned latest slot is NOT a network publication/ACL lease.
"""
from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from enum import Enum
from math import isfinite
from threading import Event, RLock
from time import monotonic
from uuid import uuid4

from .computation_context import ContextInput, ContextVersion, build_context
from .lighting import LightResult, LightState
from .line_of_sight import Point, SightResult


@dataclass(frozen=True, slots=True)
class RequestBudget:
    max_segments: int
    max_sources: int
    max_queries: int
    preparation_seconds: float
    query_seconds: float

    def __post_init__(self):
        for name in ('max_segments', 'max_sources', 'max_queries'):
            if type(getattr(self, name)) is not int or getattr(self, name) < 0:
                raise ValueError('count budgets must be explicit nonnegative integers')
        for name in ('preparation_seconds', 'query_seconds'):
            value = getattr(self, name)
            if type(value) not in (int, float):
                raise ValueError('time budgets must be explicit positive finite seconds')
            try:
                value = float(value)
            except OverflowError as exc:
                raise ValueError('time budget must be finite') from exc
            if not isfinite(value) or value <= 0:
                raise ValueError('time budgets must be positive finite seconds')
            object.__setattr__(self, name, value)
        if not isfinite(self.preparation_seconds + self.query_seconds):
            raise ValueError('total waiting budget must be finite')


@dataclass(frozen=True, slots=True)
class PointQuery:
    observer: Point
    target: Point


@dataclass(frozen=True, slots=True)
class PointAnswer:
    query: PointQuery
    sight: SightResult
    light: LightResult


class ComputationState(str, Enum):
    COMPLETE = 'complete'  # completed computation, NOT permission or perpetual freshness
    UNAVAILABLE = 'unavailable'
    INCOMPLETE = 'incomplete'


@dataclass(frozen=True, slots=True)
class ComputationResult:
    request_scope: str
    generation: int
    state: ComputationState
    version: ContextVersion | None = None
    answers: tuple[PointAnswer, ...] = ()
    reason: str | None = None
    preparation_seconds: float = 0.
    query_seconds: float = 0.


class _Stop(Exception):
    def __init__(self, state, reason):
        self.state, self.reason = state, reason


class ComputationRunner:
    """Owned, finite-admission experiment. Callers explicitly choose worker count.

    Each run advances request generation, even for identical/ABA state revision.
    A busy request invalidates older work but is NOT silently queued. Retry is a
    caller decision. State changes without a new run require explicit invalidate.
    No database observer, global cache, production limits or generic job broker.
    """
    def __init__(self, *, workers: int, clock=monotonic):
        if type(workers) is not int or workers < 1:
            raise ValueError('workers must be an explicit positive integer')
        self._pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix='laterna-computation')
        self._workers, self._clock = workers, clock
        self._lock = RLock()
        self._scope, self._generation = uuid4().hex, 0
        self._jobs = {}  # real concurrent Futures -> cancellation Events; retained until actual completion
        self._latest = None
        self._closed = False

    def _advance(self):
        self._generation += 1
        self._latest = None
        for event in self._jobs.values():
            event.set()
        return self._generation

    def invalidate(self):
        """Producer notification, not an automatic proof of DB state freshness."""
        with self._lock:
            self._advance()

    @property
    def latest(self) -> ComputationResult | None:
        """Only the internally accepted current result; never an authorization API."""
        with self._lock:
            return self._latest

    def _current(self, generation):
        with self._lock:
            return not self._closed and generation == self._generation

    def _failure(self, generation, state, reason, **kwargs):
        return ComputationResult(self._scope, generation, state, reason=reason, **kwargs)

    def _finished(self, future):
        with self._lock:
            self._jobs.pop(future, None)

    def _cancel(self, generation, event):
        event.set()
        with self._lock:
            # Cancelling an older awaiter MUST NOT clear the new accepted result.
            if generation == self._generation:
                self._advance()

    def _work(self, data, queries, budget, generation, event, total_deadline):
        start = self._clock()
        phase_start, phase_deadline, phase = start, start + budget.preparation_seconds, 'preparation'
        prepared_seconds, version = 0., None
        def checkpoint():
            if not self._current(generation):
                raise _Stop(ComputationState.UNAVAILABLE, 'stale')
            if event.is_set():
                raise _Stop(ComputationState.INCOMPLETE, 'cancelled')
            now = self._clock()
            if now >= min(phase_deadline, total_deadline):
                raise _Stop(ComputationState.INCOMPLETE, phase + '_budget')
        try:
            checkpoint()
            if type(data) is not ContextInput or type(data.segments) is not tuple or type(data.sources) is not tuple or type(queries) is not tuple:
                raise ValueError('expected immutable context/query captures')
            if len(data.segments) > budget.max_segments or len(data.sources) > budget.max_sources or len(queries) > budget.max_queries:
                raise _Stop(ComputationState.INCOMPLETE, 'count_budget')
            context = build_context(data, checkpoint=checkpoint)
            checkpoint()
            version = context.version
            prepared_seconds = self._clock() - start
            phase_start, phase = self._clock(), 'query'
            phase_deadline = phase_start + budget.query_seconds
            answers = []
            for query in queries:
                checkpoint()
                if type(query) is not PointQuery:
                    raise ValueError('expected immutable PointQuery')
                for point in (query.observer, query.target):
                    if type(point) is not tuple or len(point) != 2 or any(type(v) not in (int, float) for v in point):
                        raise ValueError('query positions must be immutable native-number pairs')
                sight = context.geometry.point_sight(query.observer, query.target)
                checkpoint()
                light = context.lighting.point_light(query.target)
                checkpoint()
                if light.state is LightState.UNAVAILABLE:
                    raise _Stop(ComputationState.UNAVAILABLE, 'lighting_unavailable')
                answers.append(PointAnswer(query, sight, light))
            checkpoint()
            return ComputationResult(self._scope, generation, ComputationState.COMPLETE,
                                     version, tuple(answers), preparation_seconds=prepared_seconds,
                                     query_seconds=self._clock() - phase_start)
        except _Stop as exc:
            state, reason = exc.state, exc.reason
        except (ValueError, TypeError):
            state, reason = ComputationState.UNAVAILABLE, 'invalid_input'
        # All aborted batches discard every point, including prior positive ones.
        return self._failure(generation, state, reason, version=version,
            preparation_seconds=(self._clock() - start if phase == 'preparation' else prepared_seconds),
            query_seconds=(self._clock() - phase_start if phase == 'query' else 0.))

    async def run(self, data: ContextInput, queries: tuple[PointQuery, ...], *, budget: RequestBudget) -> ComputationResult:
        if type(budget) is not RequestBudget:
            raise TypeError('explicit RequestBudget required')
        loop = asyncio.get_running_loop()
        seconds = budget.preparation_seconds + budget.query_seconds
        deadline, wall_deadline = self._clock() + seconds, loop.time() + seconds
        with self._lock:
            if self._closed:
                return self._failure(self._generation, ComputationState.UNAVAILABLE, 'closed')
            generation = self._advance()
            if len(self._jobs) >= self._workers:
                return self._failure(generation, ComputationState.UNAVAILABLE, 'busy')
            event = Event()
            future = self._pool.submit(self._work, data, queries, budget, generation, event, deadline)
            self._jobs[future] = event
            future.add_done_callback(self._finished)
        wrapped = asyncio.wrap_future(future)
        # A timed-out awaiter leaves the real job tracked until it actually exits.
        wrapped.add_done_callback(lambda f: f.exception() if not f.cancelled() else None)
        try:
            result = await asyncio.wait_for(asyncio.shield(wrapped), max(0., wall_deadline - loop.time()))
        except asyncio.TimeoutError:
            self._cancel(generation, event)
            return self._failure(generation, ComputationState.INCOMPLETE, 'waiting_deadline')
        except asyncio.CancelledError:
            self._cancel(generation, event)
            raise
        with self._lock:
            if not self._current(generation):
                return self._failure(generation, ComputationState.UNAVAILABLE, 'stale')
            if self._clock() >= deadline or loop.time() >= wall_deadline:
                return self._failure(generation, ComputationState.INCOMPLETE, 'waiting_deadline')
            if result.state is ComputationState.COMPLETE:
                # Check+store is atomic w.r.t. run/invalidate/close. No await or
                # external callback between validation and this LOCAL publication.
                self._latest = result
            return result

    def close(self):
        with self._lock:
            self._closed = True
            self._advance()
        self._pool.shutdown(wait=False, cancel_futures=True)

    async def aclose(self):
        self.close()
        with self._lock:
            futures = tuple(self._jobs)
        if futures:
            await asyncio.gather(*(asyncio.wrap_future(f) for f in futures), return_exceptions=True)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        await self.aclose()
