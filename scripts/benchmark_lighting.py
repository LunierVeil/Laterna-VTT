"""Reproducible PB-01d-2 point-lighting benchmark; synthetic data only.

server/.venv/bin/python scripts/benchmark_lighting.py --samples 3
No DB, renderer, timing gate or approval for runtime integration. Allocation
passes are separate from timing passes and do not measure total process RSS.
"""
from __future__ import annotations

import argparse
import gc
import json
import math
import os
from pathlib import Path
import platform
from random import Random
import statistics
import sys
import time
import tracemalloc

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'server'))
from app.line_of_sight import PreparedGeometry
from app.lighting import Ambient, LightingField, LightSource, LightState, SourceState
from tests.fixtures.los_baseline import scenes

PROFILES = ('empty', 'room-open', 'room-closed', 'pb00-complex', 'stress-2000')


def inputs(profile, query_count):
    size = (2100., 1400.)
    positions = [(200. + 60. * (i % 4), 200. + 100. * (i // 4)) for i in range(8)]
    radius, walls = 900., []
    if profile.startswith('room-'):
        walls = [((100., 100.), (900., 100.)), ((900., 100.), (900., 900.)),
                 ((900., 900.), (100., 900.)), ((100., 900.), (100., 100.)),
                 ((500., 100.), (500., 400.)), ((500., 600.), (500., 900.))]
        if profile == 'room-closed':
            walls.append(((500., 400.), (500., 600.)))
    elif profile == 'pb00-complex':
        data = scenes()['complex']
        walls = [((w['x1'], w['y1']), (w['x2'], w['y2'])) for w in data['walls']]
        positions = [(105. + 126. * i, 105.) for i in range(8)]
    elif profile == 'stress-2000':
        size, radius = (8192., 8192.), 6000.
        walls = [((200. + 70. * (i % 100), 400. + 350. * (i // 100)),
                  (235. + 70. * (i % 100), 430. + 350. * (i // 100))) for i in range(2000)]
        positions = [(105. + 63. * i, 105.) for i in range(8)]
    rng = Random(10120 + PROFILES.index(profile))
    targets = [(rng.uniform(120, 880), rng.uniform(120, 880)) if profile.startswith('room-')
               else (rng.uniform(0, size[0]), rng.uniform(0, size[1])) for _ in range(query_count)]
    return walls, size, positions, radius, targets


def timed(fn, samples):
    values = []
    for _ in range(samples):
        gc.collect()
        start = time.perf_counter_ns()
        result = fn()
        values.append((time.perf_counter_ns() - start) / 1e6)
        del result
    return dict(median_ms=statistics.median(values),
                p95_ms=sorted(values)[math.ceil(.95 * samples) - 1], samples_ms=values)


def memory(fn):
    gc.collect()
    tracemalloc.start()
    try:
        result = fn()
        retained, peak = tracemalloc.get_traced_memory()
        return dict(retained_bytes=retained, peak_bytes=peak)
    finally:
        tracemalloc.stop()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--samples', type=int, default=3)
    parser.add_argument('--queries', type=int, default=100)
    parser.add_argument('--sources', type=int, nargs='+', default=[1, 4, 8])
    parser.add_argument('--profiles', choices=PROFILES, nargs='+', default=list(PROFILES))
    args = parser.parse_args()
    if args.samples < 1 or args.queries < 1 or any(not 1 <= n <= 8 for n in args.sources):
        parser.error('samples/queries positive; synthetic layouts provide 1..8 positions (not an engine cap)')
    print(json.dumps({'environment': dict(python=sys.version, platform=platform.platform(),
        cpu_count=os.cpu_count(), samples=args.samples, queries=args.queries,
        p95='nearest-rank; max for 3 samples', memory='separate tracemalloc, not RSS',
        warmup='one unmeasured preparation and point batch per case')}), flush=True)
    for profile in args.profiles:
        walls, size, positions, radius, targets = inputs(profile, args.queries)
        build_geometry = lambda: PreparedGeometry(walls, width=size[0], height=size[1])
        g = build_geometry()
        print(json.dumps({'geometry': dict(profile=profile, walls=len(walls),
            time=timed(build_geometry, args.samples), memory=memory(build_geometry))}), flush=True)
        for count, ambient in [(n, Ambient.NONE) for n in args.sources] + [(max(args.sources), Ambient.FULL)]:
            build_sources = lambda: tuple(LightSource(g, p, radius) for p in positions[:count])
            sources = build_sources()
            assert all(s.state is SourceState.READY for s in sources)
            build_field = lambda: LightingField(g, sources, ambient=ambient)
            field = build_field()
            query = lambda: tuple(field.point_light(target) for target in targets)
            reference_batch = query()
            assert not any(r.state is LightState.UNAVAILABLE for r in reference_batch)
            row = dict(profile=profile, walls=len(walls), sources=count, ambient=ambient.value,
                       queries=len(targets), lit=sum(r.state is LightState.LIT for r in reference_batch),
                       unlit=sum(r.state is LightState.UNLIT for r in reference_batch),
                       source_preparation=timed(build_sources, args.samples),
                       field_preparation=timed(build_field, args.samples), queries_time=timed(query, args.samples))
            print(json.dumps({'timing': row}), flush=True)
            print(json.dumps({'memory': dict(profile=profile, sources=count, ambient=ambient.value,
                source_preparation=memory(build_sources), field_preparation=memory(build_field),
                queries=memory(query))}), flush=True)


if __name__ == '__main__':
    main()
