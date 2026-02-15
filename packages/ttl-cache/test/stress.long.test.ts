import { describe, expect, it } from 'vitest';
import { TtlCache } from '../src/index.js';

const DEFAULT_DURATION_MS = 5 * 60_000;
const DEFAULT_LOG_INTERVAL_MS = 15_000;
const DEFAULT_CONCURRENCY = 64;
const DEFAULT_BATCH_SIZE = 128;
const DEFAULT_MAX_SIZE = 8_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function readIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

describe('stress (long-running)', () => {
  it(
    'stays bounded under churn with get/set/getOrSet/SWR mix',
    { timeout: readIntEnv('STRESS_TIMEOUT_MS', DEFAULT_DURATION_MS + 30_000) },
    async () => {
      const durationMs = readIntEnv('STRESS_DURATION_MS', DEFAULT_DURATION_MS);
      const logIntervalMs = readIntEnv('STRESS_LOG_INTERVAL_MS', DEFAULT_LOG_INTERVAL_MS);
      const concurrency = readIntEnv('STRESS_CONCURRENCY', DEFAULT_CONCURRENCY);
      const batchSize = readIntEnv('STRESS_BATCH_SIZE', DEFAULT_BATCH_SIZE);

      const cache = new TtlCache<string, number>({
        ttlMs: 800,
        maxSize: DEFAULT_MAX_SIZE,
        cleanupIntervalMs: false,
      });

      const hotKeys = Array.from({ length: 100 }, (_, i) => `hot:${i}`);
      const warmKeys = Array.from({ length: 1_500 }, (_, i) => `warm:${i}`);
      const recentKeys: string[] = [];
      let unique = 0;

      const rng = createRng(2026_02_14);
      const startedAt = Date.now();
      const warmupEndsAt = startedAt + Math.floor(durationMs * 0.25);
      const endsAt = startedAt + durationMs;
      let nextLogAt = startedAt;
      let nextPruneAt = startedAt;

      let warmupHeap = 0;
      let peakHeapAfterWarmup = 0;

      while (Date.now() < endsAt) {
        const tasks = Array.from({ length: batchSize }, async () => {
          const roll = rng();
          let key: string;

          if (roll < 0.58) {
            key = hotKeys[Math.floor(rng() * hotKeys.length)];
          } else if (roll < 0.85) {
            key = warmKeys[Math.floor(rng() * warmKeys.length)];
          } else if (roll < 0.95 && recentKeys.length > 0) {
            key = recentKeys[Math.floor(rng() * recentKeys.length)];
          } else {
            key = `new:${unique}`;
            unique += 1;
          }

          recentKeys.push(key);
          if (recentKeys.length > 2_000) recentKeys.shift();

          const op = rng();
          if (op < 0.25) {
            cache.set(key, Math.floor(rng() * 1_000_000), { ttlMs: 300 + Math.floor(rng() * 1_500) });
            return;
          }

          if (op < 0.5) {
            cache.get(key);
            return;
          }

          await cache.getOrSet(
            key,
            async () => {
              await sleep(2 + Math.floor(rng() * 12));
              return Math.floor(rng() * 1_000_000);
            },
            {
              ttlMs: 300 + Math.floor(rng() * 800),
              swrMs: 200 + Math.floor(rng() * 1_000),
              dedupe: true,
            },
          );
        });

        for (let i = 0; i < tasks.length; i += concurrency) {
          const chunk = tasks.slice(i, i + concurrency);
          await Promise.all(chunk);
        }

        const now = Date.now();
        const mem = process.memoryUsage();

        if (now >= warmupEndsAt) {
          if (warmupHeap === 0) warmupHeap = mem.heapUsed;
          peakHeapAfterWarmup = Math.max(peakHeapAfterWarmup, mem.heapUsed);
        }

        if (now >= nextPruneAt) {
          cache.prune();
          nextPruneAt = now + 2_000;
        }

        if (now >= nextLogAt) {
          const stats = cache.getStats();
          const inflightSize = ((cache as unknown as { inflight: Map<string, Promise<number>> }).inflight?.size ?? 0);
          console.log(
            `[stress:ttl-cache] t=${((now - startedAt) / 1000).toFixed(1)}s rss=${formatMb(mem.rss)} heap=${formatMb(mem.heapUsed)} size=${stats.size} inflight=${inflightSize} hits=${stats.hits} misses=${stats.misses} stale=${stats.stale} loads=${stats.loads} evictions=${stats.evictions}`,
          );
          nextLogAt = now + logIntervalMs;
        }
      }

      cache.prune();
      const finalStats = cache.getStats();
      const finalMem = process.memoryUsage();
      const growthBytes = warmupHeap > 0 ? peakHeapAfterWarmup - warmupHeap : 0;

      console.log(
        `[stress:ttl-cache] done duration=${durationMs}ms rss=${formatMb(finalMem.rss)} heap=${formatMb(finalMem.heapUsed)} peakGrowthAfterWarmup=${formatMb(growthBytes)}`,
      );

      expect(finalStats.size).toBeLessThanOrEqual(DEFAULT_MAX_SIZE);
      expect(finalStats.hits + finalStats.misses).toBeGreaterThan(0);
      expect(finalStats.loads).toBeGreaterThan(0);
      expect(growthBytes).toBeLessThan(96 * 1024 * 1024);

      cache.dispose();
    },
  );
});
