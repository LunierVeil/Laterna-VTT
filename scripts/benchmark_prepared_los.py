"""PB-01c reproducible pure geometry benchmark; no database or application startup.

server/.venv/bin/python scripts/benchmark_prepared_los.py --samples 5
Preparation: 200/2000/10000 segments. Batches: 100/1000/10000 actual queries,
24 walls per batch profile. These are separate axes, not extrapolated timings.
PB-01a/PB-01b are read from their fixed Git commits; no network or user data.
No CI timing gates, production workload approval, lighting or FoW integration.
"""
from __future__ import annotations

import argparse
import json
import math
import os
from pathlib import Path
import platform
import random
import statistics
import subprocess
import sys
import time
import types

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))
from app.line_of_sight import PreparedGeometry
from tests.fixtures.los_baseline import scenes

REFERENCES = {
    "pb01a": "cb45d31fd52daa1e9d83cd7e5bb261f4c4c5635d",
    "pb01b": "7c2d6b342242087eaf93657e2796f51d1de702a6",
}
PROFILES = ("corridor", "maze", "nearby", "door_changes")


def reference(name):
    source = subprocess.check_output(
        ["git", "show", REFERENCES[name] + ":server/app/line_of_sight.py"], cwd=ROOT, text=True)
    module = types.ModuleType("reference_" + name)
    sys.modules[module.__name__] = module
    exec(compile(source, REFERENCES[name] + ":line_of_sight.py", "exec"), module.__dict__)
    return module.point_sight


def geometry(profile, count):
    if profile in ("corridor", "door_changes"):
        walls = [((200. + i % 1800, 500.), (200. + i % 1800, 600.)) for i in range(count)]
        return (100., 100.), (1800., 100.), walls
    if profile == "maze":
        walls = []
        for i in range(count):
            x, y = 200. + i % 6 * 300., 150. + (i // 6) % 4 * 250.
            walls.append(((x, y), (x, y + 200.)) if i % 2 else ((x, y), (x + 220., y)))
        return (100., 100.), (1800., 1200.), walls
    walls = [((10. + i % 1300, 10. + i % 1300 + 1.5e-7),
              (11. + i % 1300, 11. + i % 1300 + 1.5e-7)) for i in range(count)]
    return (0., 0.), (1400., 1400.), walls


def prepare(walls):
    return PreparedGeometry(walls, width=2100, height=1400)


def timed(fn, samples):
    fn()  # warmup, excluded
    values = []
    for _ in range(samples):
        started = time.perf_counter_ns()
        fn()
        values.append((time.perf_counter_ns() - started) / 1e6)
    return {"median_ms": statistics.median(values),
            "p95_ms": sorted(values)[math.ceil(.95 * samples) - 1], "samples_ms": values}


def equivalence(old_a, old_b):
    checked = 0
    rng = random.Random(310103)
    datasets = [data["walls"] for data in scenes().values()]
    # Raw PB-00 segments are explicit opaque inputs, not a production window rule.
    for raw in datasets:
        walls = [((w["x1"], w["y1"]), (w["x2"], w["y2"])) for w in raw]
        snapshot = prepare(walls)
        for _ in range(20):
            a, b = [(rng.uniform(0, 2100), rng.uniform(0, 1400)) for _ in range(2)]
            result = snapshot.point_sight(a, b)
            for old in (old_a, old_b):
                expected = old(a, b, walls, width=2100, height=1400)
                assert (result.state.value, result.ignored_zero_length) == (expected.state.value, expected.ignored_zero_length)
                checked += 1
    for _ in range(1000):
        walls = [(tuple(rng.uniform(0, 8192) for _ in range(2)),
                  tuple(rng.uniform(0, 8192) for _ in range(2)))]
        snapshot = PreparedGeometry(walls, width=8192, height=8192)
        a, b = [tuple(rng.uniform(0, 8192) for _ in range(2)) for _ in range(2)]
        result = snapshot.point_sight(a, b)
        for old in (old_a, old_b):
            expected = old(a, b, walls, width=8192, height=8192)
            assert (result.state.value, result.ignored_zero_length) == (expected.state.value, expected.ignored_zero_length)
            checked += 1
    return checked


def run(samples):
    old_a, old_b = reference("pb01a"), reference("pb01b")
    print(json.dumps({"environment": {"python": sys.version, "platform": platform.platform(),
          "affinity_cpus": len(os.sched_getaffinity(0)) if hasattr(os, "sched_getaffinity") else os.cpu_count()},
          "references": REFERENCES, "samples": samples, "p95": "nearest rank; max when samples < 20",
          "equivalence_comparisons": equivalence(old_a, old_b)}), flush=True)
    for count in (200, 2000, 10000):
        for profile in PROFILES:
            a, b, walls = geometry(profile, count)
            snapshot = prepare(walls)
            expected = old_a(a, b, walls, width=2100, height=1400)
            actual = snapshot.point_sight(a, b)
            assert (actual.state.value, actual.ignored_zero_length) == (expected.state.value, expected.ignored_zero_length)
            # Reuse timings are separate from preparation, without database IO.
            print(json.dumps({"mode": "prepare_and_single_reuse", "walls": count, "profile": profile,
                  "prepare": timed(lambda: prepare(walls), samples),
                  "old_query": timed(lambda: old_b(a, b, walls, width=2100, height=1400), samples),
                  "prepared_query": timed(lambda: snapshot.point_sight(a, b), samples)}), flush=True)
    door = ((350., 0.), (350., 350.))
    for count in (100, 1000, 10000):
        for profile in PROFILES:
            a, b, walls = geometry(profile, 24)
            snapshot = prepare(walls)
            def old_queries():
                for i in range(count):
                    current = walls + ([door] if i % 2 == 0 else []) if profile == "door_changes" else walls
                    old_b(a, b, current, width=2100, height=1400)
            def prepared_queries():
                for i in range(count):
                    current = prepare(walls + ([door] if i % 2 == 0 else [])) if profile == "door_changes" else snapshot
                    current.point_sight(a, b)
            # Alternate order by profile/count; no parallel test/build workload.
            if (count + PROFILES.index(profile)) % 2:
                new_time, old_time = timed(prepared_queries, samples), timed(old_queries, samples)
            else:
                old_time, new_time = timed(old_queries, samples), timed(prepared_queries, samples)
            print(json.dumps({"mode": "refresh_and_query" if profile == "door_changes" else "query_only",
                  "profile": profile, "walls": 24, "rays": count,
                  "old_batch": old_time, "prepared_batch": new_time}), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--samples", type=int, default=5)
    args = parser.parse_args()
    if args.samples < 3:
        parser.error("use at least three samples")
    run(args.samples)
