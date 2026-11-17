/**
 * Trend aggregation over token-footprint history.
 *
 * Buckets {@link TokenSnapshot} records by a {@link TrendPeriod} (using local
 * calendar time) and summarizes each bucket. Zero runtime dependencies.
 */

import type { TokenSnapshot, TrendBucket, TrendPeriod } from '../types';

/** The valid trend periods, for validation in the CLI. */
export const TREND_PERIODS: readonly TrendPeriod[] = [
  'hourly',
  'daily',
  'weekly',
  'monthly',
  'quarterly',
  'yearly',
];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * ISO-8601 week number and week-year for a local date.
 *
 * Uses UTC arithmetic on the local calendar components to stay DST-safe.
 */
function isoWeek(date: Date): { year: number; week: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  // Shift to the Thursday of the current ISO week (Mon=0 … Sun=6).
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000));
  return { year: d.getUTCFullYear(), week };
}

/**
 * Compute the bucket key a date falls into for a given period (local time).
 */
export function bucketKey(date: Date, period: TrendPeriod): string {
  const y = date.getFullYear();
  const mo = pad2(date.getMonth() + 1);
  const da = pad2(date.getDate());
  switch (period) {
    case 'hourly':
      return `${y}-${mo}-${da} ${pad2(date.getHours())}:00`;
    case 'daily':
      return `${y}-${mo}-${da}`;
    case 'weekly': {
      const { year, week } = isoWeek(date);
      return `${year}-W${pad2(week)}`;
    }
    case 'monthly':
      return `${y}-${mo}`;
    case 'quarterly':
      return `${y}-Q${Math.floor(date.getMonth() / 3) + 1}`;
    case 'yearly':
      return `${y}`;
  }
}

/**
 * Aggregate snapshots into per-period buckets.
 *
 * Snapshots sharing the same timestamp (one audit run can scan several configs)
 * are first summed into a single per-run footprint, so each run counts once.
 */
export function aggregateTrends(
  snapshots: TokenSnapshot[],
  period: TrendPeriod,
): TrendBucket[] {
  // 1. Collapse configs of the same run (same ts) into one total.
  const runTotals = new Map<string, number>();
  for (const s of snapshots) {
    runTotals.set(s.ts, (runTotals.get(s.ts) ?? 0) + s.totalTokens);
  }

  // 2. Order runs chronologically so "last" reflects the most recent run.
  const runs = [...runTotals.entries()]
    .map(([ts, total]) => ({ ts, total, date: new Date(ts) }))
    .filter((r) => !Number.isNaN(r.date.getTime()))
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  // 3. Group runs into period buckets.
  const buckets = new Map<string, TrendBucket>();
  for (const run of runs) {
    const key = bucketKey(run.date, period);
    const existing = buckets.get(key);
    if (!existing) {
      buckets.set(key, {
        bucket: key,
        samples: 1,
        avgTokens: run.total,
        minTokens: run.total,
        maxTokens: run.total,
        lastTokens: run.total,
      });
    } else {
      // avgTokens temporarily holds the running sum; finalized below.
      existing.samples += 1;
      existing.avgTokens += run.total;
      existing.minTokens = Math.min(existing.minTokens, run.total);
      existing.maxTokens = Math.max(existing.maxTokens, run.total);
      existing.lastTokens = run.total; // runs are time-ascending
    }
  }

  // 4. Finalize averages and return chronologically (keys sort naturally).
  const result = [...buckets.values()].map((b) =>
    b.samples === 1 ? b : { ...b, avgTokens: Math.round(b.avgTokens / b.samples) },
  );
  result.sort((a, b) => (a.bucket < b.bucket ? -1 : a.bucket > b.bucket ? 1 : 0));
  return result;
}
