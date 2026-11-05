"""PB-01b independent review: fixed PB-01a equivalence and non-gating timings.

Run from the repository: server/.venv/bin/python scripts/benchmark_los.py
Use --equivalence-only to compare results without collecting timings.
Requires Git history containing PB-01a. Uses only synthetic data, stdlib and
repository modules; does not import the application, database or user data.
21 interleaved samples per algorithm/profile/size, one warmup per algorithm;
p95 is nearest-rank. Timings include input validation and cannot approve an FPS
or production throughput target. Do not run alongside other test/build workloads.
"""
import argparse
import sys, math, random, json, statistics, time, platform, os, subprocess, types
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'server'))
import app.line_of_sight as new
from tests.fixtures.los_baseline import scenes
REFERENCE_COMMIT = 'cb45d31fd52daa1e9d83cd7e5bb261f4c4c5635d'
source = subprocess.check_output(['git', 'show', REFERENCE_COMMIT + ':server/app/line_of_sight.py'], cwd=ROOT, text=True)
old = types.ModuleType('pb01a_fixed')
sys.modules[old.__name__] = old
exec(compile(source, REFERENCE_COMMIT + ':line_of_sight.py', 'exec'), old.__dict__)
count = 0

def compare(a, b, walls, epsilon=1e-07):
    global count
    kwargs = dict(width=8192, height=8192, epsilon=epsilon)
    expected = old.point_sight(a, b, walls, **kwargs)
    got = new.point_sight(a, b, iter(walls), **kwargs)
    assert (got.state.value, got.ignored_zero_length) == (expected.state.value, expected.ignored_zero_length), (a, b, walls, epsilon, expected, got)
    count += 1

def equivalence():
    rng = random.Random(320031)
    # Raw fixture segments are prepared opaque inputs here, not a window policy.
    for name, scene in scenes().items():
        walls = [((w['x1'], w['y1']), (w['x2'], w['y2'])) for w in scene['walls']]
        for _ in range(12):
            a, b = [(rng.uniform(0, 2100), rng.uniform(0, 1400)) for _ in range(2)]
            compare(a, b, walls)
            compare(b, a, [w[::-1] for w in reversed(walls)])
    for i in range(12000):
        a, b, c, d = [tuple((rng.uniform(0, 8192) for _ in range(2))) for _ in range(4)]
        if i % 3 == 0:
            dx, dy = (d[0] - c[0], d[1] - c[1])
            l = math.hypot(dx, dy)
            delta = rng.choice([0.5, 1.0, 2.0]) * 1e-07
            a = (c[0] + dx * 0.25 - dy / l * delta, c[1] + dy * 0.25 + dx / l * delta)
            b = (c[0] + dx * 0.75 - dy / l * delta, c[1] + dy * 0.75 + dx / l * delta)
        if i % 11 == 0:
            b = a
        if i % 13 == 0:
            c = (rng.uniform(0, 8192), 0.0)
            d = (c[0], math.nextafter(0.0, 1.0))
        walls = [(c, d), ((100.0, 100.0), (100.0, 100.0))]
        compare(a, b, walls)
        compare(a, b, [(d, c), walls[1]])
    for origin in (0.0, 100.0, 8191.0):
        for eps in (math.nextafter(0.0, 1.0), 1e-300, 1e-07, 0.5):
            for factor in (0.5, 1.0, 2.0):
                y = origin + eps * factor
                if y > 8192:
                    continue
                for yy in (math.nextafter(y, -math.inf), y, math.nextafter(y, math.inf)):
                    if yy < 0 or yy > 8192:
                        continue
                    compare((1.0, yy), (8.0, yy), [((3.0, origin), (7.0, origin))], eps)
                    compare((yy, 4.0), (8.0, 4.0), [((origin, 0.0), (origin, 8.0))], eps)
    for gap in (1e-07, 2e-07, 4e-07):
        compare((0.0, 100.0 + gap / 2), (8192.0, 100.0 + gap / 2), [((4096.0, 0.0), (4096.0, 100.0)), ((4096.0, 100.0 + gap), (4096.0, 8192.0))])
    for n in (200, 2000, 10000):
        for name in PROFILES:
            a, b, walls = profile(name, n)
            walls = walls + [walls[-1], ((8192.0, 8192.0), (8192.0, 8192.0))]
            compare(a, b, walls)
            compare(b, a, [w[::-1] for w in reversed(walls)])
    print('EQUIVALENCE PASS', count, 'comparisons; states AND ignored_zero_length', flush=True)
    return count
PROFILES = ['far_box', 'inside_box_off_line', 'dense_maze', 'near_tangent', 'first_blocker', 'free_corridor']

def profile(name, n):
    if name == 'far_box':
        return ((0.0, 100.0), (8192.0, 100.0), [((float(i % 8192), 5000.0), (float(i % 8192), 6000.0)) for i in range(n)])
    if name == 'inside_box_off_line':
        return ((0.0, 0.0), (8192.0, 8192.0), [((1000.0 + i % 100 * 3, 6000.0 + i // 100 * 0.5), (2000.0 + i % 100 * 3, 6500.0 + i // 100 * 0.5)) for i in range(n)])
    if name == 'dense_maze':
        return ((1000.0, 1000.0), (7000.0, 7000.0), [((0.0, 3000.0 + i % 100 * 20), (3000.0 + i % 100 * 20, 0.0)) for i in range(n)])
    if name == 'near_tangent':
        return ((0.0, 0.0), (8192.0, 8192.0), [((10.0 + i % 8000, 10.0 + i % 8000 + 1.5e-07), (11.0 + i % 8000, 11.0 + i % 8000 + 1.5e-07)) for i in range(n)])
    if name == 'first_blocker':
        return ((0.0, 100.0), (8192.0, 100.0), [((100.0, 0.0), (100.0, 200.0))] + profile('far_box', n - 1)[2])
    return ((0.0, 100.0), (8192.0, 100.0), [((float(i % 8192), 0.0 if i % 2 else 110.0), (float(i % 8192), 90.0 if i % 2 else 200.0)) for i in range(n)])

def benchmark():
    rows = []
    for n in (200, 2000, 10000):
        for name in PROFILES:
            a, b, walls = profile(name, n)
            samples = {k: [] for k in ('pb01a', 'pb01b')}
            functions = {'pb01a': old.point_sight, 'pb01b': new.point_sight}
            for fn in functions.values():
                fn(a, b, walls, width=8192, height=8192)
            for rep in range(21):
                order = ('pb01a', 'pb01b') if rep % 2 else ('pb01b', 'pb01a')
                for k in order:
                    start = time.perf_counter_ns()
                    result = functions[k](a, b, walls, width=8192, height=8192)
                    samples[k].append((time.perf_counter_ns() - start) / 1000000.0)
            row = {'walls': n, 'profile': name, 'state': result.state.value}
            for k, vals in samples.items():
                row[k] = {'median_ms': statistics.median(vals), 'p95_ms': sorted(vals)[math.ceil(0.95 * len(vals)) - 1]}
            row['speedup'] = row['pb01a']['median_ms'] / row['pb01b']['median_ms']
            rows.append(row)
            print(json.dumps(row), flush=True)
    return rows
if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--equivalence-only', action='store_true',
                        help='Compare against PB-01a without collecting timings')
    args = parser.parse_args()
    print('Reference', REFERENCE_COMMIT, 'samples', 21, 'p95', 'nearest-rank', flush=True)
    print('Python', sys.version, 'platform', platform.platform(), 'affinity_cpus', len(os.sched_getaffinity(0)) if hasattr(os, 'sched_getaffinity') else os.cpu_count(), flush=True)
    equivalence()
    if not args.equivalence_only:
        benchmark()
