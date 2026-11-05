"""PB-01d-1: reproducible pure geometry timings and Python allocation peaks.

server/.venv/bin/python scripts/benchmark_visibility_area.py --samples 3
No timing gate, DB, render loop or authorization. Memory passes are separate
from timing passes: tracemalloc peak is not RSS or an estimate of GPU memory.
"""
from __future__ import annotations

import argparse
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
sys.path.insert(0, str(ROOT / "server"))
from app.line_of_sight import PreparedGeometry
from app.visibility_area import PreparedVisibilityGeometry

PROFILES = ("grid", "occluded", "crossings")


def geometry(profile, count):
    """Unique segments in 8192px, including genuinely intersecting arrangements."""
    walls = []
    for i in range(count - (profile == "occluded")):
        pair = i // 2 if profile == "crossings" else i
        x, y = 1000. + 50. * (pair % 100), 100. + (160. if profile == "crossings" else 80.) * (pair // 100)
        if profile == "crossings":
            walls.append(((x - 10., y - 10.), (x + 10., y + 10.)) if i % 2 == 0
                         else ((x - 10., y + 10.), (x + 10., y - 10.)))
        else:
            walls.append(((x, y), (x, y + 10.)))
    if profile == "occluded":
        walls.insert(0, ((500., 0.), (500., 8192.)))
    return (100., 4000.), walls


def timed(fn, samples):
    values = []
    for _ in range(samples):
        gc.collect()  # outside timed interval; GC remains enabled during the call
        start = time.perf_counter_ns()
        result = fn()
        values.append((time.perf_counter_ns() - start) / 1e6)
        del result
    return {"median_ms": statistics.median(values),
            "p95_ms": sorted(values)[math.ceil(.95 * len(values)) - 1], "samples_ms": values}


def memory(fn):
    gc.collect()
    tracemalloc.start()
    try:
        result = fn()
        current, peak = tracemalloc.get_traced_memory()
        return {"retained_bytes": current, "peak_bytes": peak}
    finally:
        tracemalloc.stop()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--samples", type=int, default=3)
    parser.add_argument("--counts", nargs="+", type=int, default=[200, 2000, 10000])
    parser.add_argument("--profiles", nargs="+", choices=PROFILES, default=list(PROFILES))
    parser.add_argument("--skip-memory", action="store_true", help="timing-only exploratory run")
    args = parser.parse_args()
    if args.samples < 1 or any(n < 2 or n > 10000 for n in args.counts):
        parser.error("samples >=1; counts between 2 and 10000 for these fixed synthetic layouts")
    print(json.dumps({"environment": {"python": sys.version, "platform": platform.platform(),
                                     "cpu_count": os.cpu_count(), "samples": args.samples,
                                     "p95": "nearest-rank; for 3 samples this is max",
                                     "warmup": "20-wall warmup plus one unmeasured contour/count check per case",
                                     "memory": "separate tracemalloc passes; not RSS"}}), flush=True)
    origin, small = geometry("grid", 20)
    PreparedVisibilityGeometry(PreparedGeometry(small, width=8192, height=8192)).visibility_area(origin)
    for profile in args.profiles:
        for count in args.counts:
            origin, walls = geometry(profile, count)
            build_source = lambda: PreparedGeometry(walls, width=8192, height=8192)
            source = build_source()
            build_prepared = lambda: PreparedVisibilityGeometry(source)
            prepared = build_prepared()
            build_contour = lambda: prepared.visibility_area(origin)
            contour = build_contour()
            row = {"profile": profile, "walls": count, "unique": prepared.unique_segment_count,
                   "intersection_points": prepared.intersection_point_count,
                   "candidate_pairs": prepared.candidate_pair_count,
                   "directions": contour.direction_count, "rays": 2 * contour.direction_count,
                   "vertices": len(contour.contour),
                   "source": timed(build_source, args.samples),
                   "preparation": timed(build_prepared, args.samples),
                   "contour": timed(build_contour, args.samples)}
            print(json.dumps({"timing": row}), flush=True)
            if not args.skip_memory:
                print(json.dumps({"memory": {"profile": profile, "walls": count,
                    "source": memory(build_source), "preparation": memory(build_prepared),
                    "contour": memory(build_contour)}}), flush=True)


if __name__ == "__main__":
    main()
