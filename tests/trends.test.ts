import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { bucketKey, aggregateTrends, TREND_PERIODS } from '../src/history/trends';
import { appendSnapshots, readHistory, getHistoryPath } from '../src/history/history-store';
import type { TokenSnapshot } from '../src/types';

describe('bucketKey', () => {
  // Build with LOCAL components so bucketing is deterministic regardless of TZ.
  const d = new Date(2026, 10, 17, 14, 30, 0); // 2026-11-17 14:30 local

  it('formats each period', () => {
    expect(bucketKey(d, 'hourly')).toBe('2026-11-17 14:00');
    expect(bucketKey(d, 'daily')).toBe('2026-11-17');
    expect(bucketKey(d, 'monthly')).toBe('2026-11');
    expect(bucketKey(d, 'quarterly')).toBe('2026-Q4');
    expect(bucketKey(d, 'yearly')).toBe('2026');
  });

  it('computes ISO week (incl. year boundary)', () => {
    // 2026-01-01 is a Thursday -> ISO week 1 of 2026.
    expect(bucketKey(new Date(2026, 0, 1), 'weekly')).toBe('2026-W01');
    // 2025-12-31 falls in the ISO week that belongs to 2026.
    expect(bucketKey(new Date(2025, 11, 31), 'weekly')).toBe('2026-W01');
  });

  it('covers all declared periods', () => {
    for (const p of TREND_PERIODS) {
      expect(typeof bucketKey(d, p)).toBe('string');
    }
  });
});

describe('aggregateTrends', () => {
  const snaps: TokenSnapshot[] = [
    // Run A: two configs at the same timestamp -> one footprint reading of 150.
    { ts: '2026-11-17T10:00:00.000Z', source: 'Claude', path: '/a', totalTokens: 100, serverCount: 2 },
    { ts: '2026-11-17T10:00:00.000Z', source: 'Cursor', path: '/b', totalTokens: 50, serverCount: 1 },
    // Run B: later, single config.
    { ts: '2026-11-17T12:00:00.000Z', source: 'Claude', path: '/a', totalTokens: 200, serverCount: 3 },
  ];

  it('collapses same-ts configs and aggregates per bucket', () => {
    const buckets = aggregateTrends(snaps, 'yearly');
    expect(buckets).toHaveLength(1);
    const b = buckets[0]!;
    expect(b.bucket).toBe('2026');
    expect(b.samples).toBe(2); // two runs, not three configs
    expect(b.minTokens).toBe(150);
    expect(b.maxTokens).toBe(200);
    expect(b.lastTokens).toBe(200); // most recent run
    expect(b.avgTokens).toBe(175); // round((150 + 200) / 2)
  });

  it('returns empty for no snapshots', () => {
    expect(aggregateTrends([], 'daily')).toEqual([]);
  });

  it('ignores snapshots with unparseable timestamps', () => {
    const bad: TokenSnapshot[] = [
      { ts: 'not-a-date', source: 'x', path: '/x', totalTokens: 10, serverCount: 1 },
    ];
    expect(aggregateTrends(bad, 'yearly')).toEqual([]);
  });
});

describe('history-store', () => {
  let file: string;
  beforeEach(() => {
    file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-slim-')), 'history.jsonl');
  });
  afterEach(() => {
    try {
      fs.rmSync(path.dirname(file), { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('appends and reads back snapshots (round-trip)', () => {
    const a: TokenSnapshot = { ts: '2026-11-17T10:00:00.000Z', source: 'Claude', path: '/a', totalTokens: 100, serverCount: 2 };
    const b: TokenSnapshot = { ts: '2026-11-17T12:00:00.000Z', source: 'Claude', path: '/a', totalTokens: 200, serverCount: 3 };
    expect(appendSnapshots([a], file)).toBe(true);
    expect(appendSnapshots([b], file)).toBe(true);
    const read = readHistory(file);
    expect(read).toHaveLength(2);
    expect(read[0]).toEqual(a);
    expect(read[1]).toEqual(b);
  });

  it('returns empty history for a missing file', () => {
    expect(readHistory(path.join(os.tmpdir(), 'does-not-exist-xyz', 'h.jsonl'))).toEqual([]);
  });

  it('skips malformed lines', () => {
    fs.writeFileSync(file, '{bad json}\n{"ts":"2026-11-17T10:00:00.000Z","source":"X","path":"/x","totalTokens":5,"serverCount":1}\n\n');
    const read = readHistory(file);
    expect(read).toHaveLength(1);
    expect(read[0]!.totalTokens).toBe(5);
  });
});

describe('getHistoryPath', () => {
  it('prefers an explicit path', () => {
    expect(getHistoryPath('/tmp/custom.jsonl')).toBe(path.resolve('/tmp/custom.jsonl'));
  });

  it('falls back to a default under the home dir', () => {
    const p = getHistoryPath();
    expect(p.endsWith(path.join('.mcp-slim', 'history.jsonl'))).toBe(true);
  });
});
