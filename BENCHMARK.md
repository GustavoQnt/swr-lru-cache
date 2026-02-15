# BENCHMARK - @gustavoqnt/ttl-cache

This document records benchmark methodology and the latest measured results for `@gustavoqnt/ttl-cache`.

## What this benchmark answers

- Core cache throughput (`set`, `get`, mixed operations).
- Overhead of LRU eviction and high-cardinality workloads.
- Behavior of differentiating features (`getOrSet` dedup and SWR).
- Long-run memory and eviction stability under churn.

## Benchmark artifacts

Generated logs from the latest run (February 15, 2026):

- `bench-ttl-cache-full.log`
- `stress-ttl-cache-10m.log`

## Environment of the latest run

- Date: February 15, 2026
- OS: Windows
- Node.js: `v22.19.0`
- Vitest: `2.1.9`
- Package manager: `pnpm`

## Commands

```bash
# Bench suite
pnpm -F @gustavoqnt/ttl-cache bench

# Regular tests (stress excluded)
pnpm -F @gustavoqnt/ttl-cache test

# Long stress run (10 minutes)
STRESS_DURATION_MS=600000 STRESS_TIMEOUT_MS=720000 STRESS_LOG_INTERVAL_MS=30000 pnpm -F @gustavoqnt/ttl-cache test:stress
```

## Full bench results

From `bench-ttl-cache-full.log`:

| Benchmark | hz | min | max | mean | p99 | rme | samples |
|---|---:|---:|---:|---:|---:|---:|---:|
| `set 10k entries` | 475.59 | 1.0700ms | 7.8057ms | 2.1026ms | 6.8369ms | +-6.64% | 238 |
| `get 10k entries (all hits)` | 409.25 | 1.6281ms | 8.2695ms | 2.4435ms | 5.6263ms | +-4.63% | 205 |
| `set + get mixed (10k ops)` | 905.94 | 0.7467ms | 4.0099ms | 1.1038ms | 2.6581ms | +-3.21% | 453 |
| `LRU eviction (set 20k into maxSize 10k)` | 271.21 | 2.3957ms | 7.3553ms | 3.6872ms | 7.3393ms | +-4.87% | 137 |
| `getOrSet with dedup (100 concurrent)` | 131.26 | 0.0852ms | 27.3575ms | 7.6184ms | 27.3575ms | +-20.58% | 66 |
| `getOrSet SWR (serve stale immediately)` | 49.86 | 14.9860ms | 31.6753ms | 20.0556ms | 31.6753ms | +-8.83% | 26 |
| `set 100k entries` | 36.82 | 15.6774ms | 42.9263ms | 27.1608ms | 42.9263ms | +-14.01% | 19 |
| `get 100k entries (all hits)` | 10.83 | 42.4822ms | 138.03ms | 92.3633ms | 138.03ms | +-30.19% | 10 |

Vitest summary highlights:

- `set + get mixed (10k ops)` is the fastest workload in this suite.
- It is `1.90x` faster than `set 10k entries` in this run.
- It is `6.90x` faster than `getOrSet with dedup (100 concurrent)` in this run.

## Bench interpretation

- Core paths (`set/get/mixed/LRU`) show moderate to good stability (`rme` around `3%` to `7%`).
- Concurrency-heavy and very large-batch benchmarks have higher noise (`rme > 10%`), expected due to scheduler and GC variability.
- `getOrSet` benchmarks are measuring richer behavior (loader orchestration + dedup/SWR), not just raw map access.

## Long stress test (10 minutes)

Run:

```bash
STRESS_DURATION_MS=600000 STRESS_TIMEOUT_MS=720000 STRESS_LOG_INTERVAL_MS=30000 pnpm -F @gustavoqnt/ttl-cache test:stress
```

### Summary from `stress-ttl-cache-10m.log`

- Duration completed: `600000ms` (test passed)
- Last sampled counters at `t=570.2s`:
  - `hits=2857817`
  - `misses=551934`
  - `stale=77469`
  - `loads=417535`
  - `evictions=452258`

Derived metrics:

- Observed operation throughput (`hits + misses + stale`): `6115.78 ops/s`
- Throughput range by 30s intervals: `6065.37` to `6159.27 ops/s`
- Served from cache (`hits + stale`): `84.17%`
- Miss share: `15.83%`
- Stale share: `2.22%`
- Loader executions: `732.26/s`
- Misses absorbed without new loader execution (`1 - loads/misses`): `24.35%`

### Memory and boundedness

Post-warmup window (`t >= 120s`):

- RSS range: `62.1MB` to `82.8MB`
- Heap range: `12.3MB` to `29.1MB`
- Cache size range: `1521` to `2454`
- Configured `maxSize`: `8000`
- Peak heap growth after warmup: `9.5MB`

Conclusion:

- No unbounded memory growth observed.
- Cache size stayed significantly below configured cap.
- Evictions were continuous under churn and did not cause progressive throughput collapse.

## Reproducibility and release guidance

- For release decisions, run at least 3 bench passes and compare medians.
- Keep Node, pnpm, and Vitest versions fixed.
- Treat `rme > 10%` rows as directional, not absolute.
- Preserve raw logs in CI artifacts for traceability.

## Stress tunables

- `STRESS_DURATION_MS` default: `300000`
- `STRESS_TIMEOUT_MS` default: `duration + 30000`
- `STRESS_LOG_INTERVAL_MS` default: `15000`
- `STRESS_CONCURRENCY` default: `64`
- `STRESS_BATCH_SIZE` default: `128`