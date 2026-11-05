"""PB-01d-3 synthetic request-scoped benchmark, not production budgets/SLA.

server/.venv/bin/python scripts/benchmark_computation_context.py --samples 3
No real source adapter, DB reads, event loop/game wiring, or token light mapping.
"""
from __future__ import annotations

import argparse
import asyncio
import gc
import json
import math
import os
from pathlib import Path
import platform
import statistics
import sys
import time
import tracemalloc

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'server'))
from app.computation_context import ContextInput, SourceInput, build_context
from app.computation_runner import ComputationRunner, ComputationState, PointAnswer, PointQuery, RequestBudget
from app.lighting import Ambient
from tests.fixtures.los_baseline import scenes


def cases():
    data = scenes()['complex']
    walls = tuple(((w['x1'], w['y1']), (w['x2'], w['y2'])) for w in data['walls'])
    # EXPLICIT synthetic positions/radius: never read emits_light/vision_range.
    sources = tuple(SourceInput((105. + 126. * i, 105.), 700.) for i in range(15))
    for profile in ('pb00-original', 'cross-wall'):
        points = tuple((t['x'], t['y']) for t in data['tokens'])
        if profile == 'cross-wall':
            points = tuple((x, y + 500.5) for x, y in points)
        spec = ContextInput('synthetic-' + profile, 'fixture-capture-1', data['width'], data['height'], walls, sources, Ambient.NONE)
        context = build_context(spec)  # outside the event loop, reference only, not timed
        for all_pairs in (False, True):
            queries = tuple(PointQuery(a, b) for a in (points if all_pairs else points[:1]) for b in points)
            expected = tuple(PointAnswer(q, context.geometry.point_sight(q.observer, q.target),
                                         context.lighting.point_light(q.target)) for q in queries)
            yield profile, spec, queries, expected


def summary(values):
    return dict(median_ms=statistics.median(values), p95_ms=sorted(values)[math.ceil(.95 * len(values)) - 1], samples_ms=values)


async def benchmark(inputs, samples):
    async with ComputationRunner(workers=1) as runner:  # experiment setting, not a production default
        for profile, spec, queries, expected in inputs:
            budget = RequestBudget(200, 15, len(queries), 60., 60.)  # generous benchmark-only ceiling
            warm = await runner.run(spec, queries, budget=budget)
            assert warm.state is ComputationState.COMPLETE and warm.answers == expected
            total, preparation, query = [], [], []
            for _ in range(samples):
                gc.collect()
                start = time.perf_counter_ns()
                result = await runner.run(spec, queries, budget=budget)
                total.append((time.perf_counter_ns() - start) / 1e6)
                assert result.state is ComputationState.COMPLETE and result.answers == expected
                preparation.append(result.preparation_seconds * 1000)
                query.append(result.query_seconds * 1000)
            gc.collect()
            tracemalloc.start()
            try:
                result = await runner.run(spec, queries, budget=budget)
                retained, peak = tracemalloc.get_traced_memory()
                assert result.state is ComputationState.COMPLETE and result.answers == expected
            finally:
                tracemalloc.stop()
            print(json.dumps(dict(profile=profile, tokens=30, walls=200, sources=15, queries=len(queries),
                end_to_end=summary(total), preparation=summary(preparation), point_queries=summary(query),
                memory=dict(retained_bytes=retained, peak_bytes=peak),
                geometric_states={state: sum(a.sight.state.value == state for a in result.answers)
                                  for state in ('clear', 'blocked', 'observer_on_obstacle')},
                light_states={state: sum(a.light.state.value == state for a in result.answers)
                              for state in ('lit', 'unlit', 'unavailable')})), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--samples', type=int, default=3)
    args = parser.parse_args()
    if args.samples < 1:
        parser.error('samples must be positive')
    print(json.dumps(dict(environment=dict(python=sys.version, platform=platform.platform(),
        cpu_count=os.cpu_count(), samples=args.samples, workers=1, p95='nearest-rank; maximum for 3 samples',
        memory='separate tracemalloc request pass, not RSS', warmup='one full request per case'))), flush=True)
    inputs = list(cases())  # synthetic generation/direct kernel oracle excluded from timings
    asyncio.run(benchmark(inputs, args.samples))


if __name__ == '__main__':
    main()
