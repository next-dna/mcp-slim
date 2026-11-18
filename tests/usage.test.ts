import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { normalizeUsage, buildEvent, compareUsage } from '../src/usage/usage';
import { appendEvent, readEvents, getUsagePath } from '../src/usage/usage-store';
import { parseArgs, main } from '../src/cli';
import type { UsageEvent } from '../src/types';

describe('normalizeUsage', () => {
  it('maps OpenAI fields', () => {
    expect(normalizeUsage('openai', { prompt_tokens: 1200, completion_tokens: 340, total_tokens: 1540 })).toEqual({
      input: 1200,
      output: 340,
      total: 1540,
    });
  });

  it('maps Anthropic fields and sums total', () => {
    expect(normalizeUsage('anthropic', { input_tokens: 800, output_tokens: 200 })).toEqual({
      input: 800,
      output: 200,
      total: 1000,
    });
  });

  it('maps Gemini fields', () => {
    expect(
      normalizeUsage('gemini', { promptTokenCount: 500, candidatesTokenCount: 120, totalTokenCount: 620 }),
    ).toEqual({ input: 500, output: 120, total: 620 });
  });

  it('falls back to generic keys for unknown providers', () => {
    expect(normalizeUsage('cursor', { input: 10, output: 5 })).toEqual({ input: 10, output: 5, total: 15 });
  });
});

describe('buildEvent', () => {
  it('uses explicit counts and derives total', () => {
    const e = buildEvent({ provider: 'openai', kind: 'ask', input: 100, output: 40, ts: 'T' });
    expect(e.inputTokens).toBe(100);
    expect(e.outputTokens).toBe(40);
    expect(e.totalTokens).toBe(140);
  });

  it('prefers an explicit total', () => {
    const e = buildEvent({ provider: 'x', kind: 'request', input: 100, output: 40, total: 999, ts: 'T' });
    expect(e.totalTokens).toBe(999);
  });

  it('normalizes a raw usage object and tags the model', () => {
    const e = buildEvent({
      provider: 'openai',
      kind: 'agent',
      model: 'gpt-4o',
      raw: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
      ts: 'T',
    });
    expect(e.totalTokens).toBe(10);
    expect(e.model).toBe('gpt-4o');
  });
});

describe('compareUsage', () => {
  const events: UsageEvent[] = [
    { ts: '2026-11-17T09:00:00.000Z', provider: 'openai', kind: 'ask', inputTokens: 100, outputTokens: 20, totalTokens: 120 },
    { ts: '2026-11-17T10:00:00.000Z', provider: 'openai', kind: 'ask', inputTokens: 130, outputTokens: 40, totalTokens: 170 },
    { ts: '2026-11-17T11:00:00.000Z', provider: 'anthropic', kind: 'agent', inputTokens: 900, outputTokens: 100, totalTokens: 1000 },
  ];

  it('computes latest vs previous per provider+kind', () => {
    const rows = compareUsage(events);
    const ask = rows.find((r) => r.provider === 'openai' && r.kind === 'ask')!;
    expect(ask.latest).toBe(170);
    expect(ask.previous).toBe(120);
    expect(ask.delta).toBe(50);
    expect(ask.count).toBe(2);
  });

  it('reports null previous/delta for a single event', () => {
    const rows = compareUsage(events);
    const agent = rows.find((r) => r.provider === 'anthropic')!;
    expect(agent.latest).toBe(1000);
    expect(agent.previous).toBeNull();
    expect(agent.delta).toBeNull();
    expect(agent.count).toBe(1);
  });

  it('returns empty for no events', () => {
    expect(compareUsage([])).toEqual([]);
  });
});

describe('usage-store', () => {
  let file: string;
  beforeEach(() => {
    file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-usage-')), 'usage.jsonl');
  });
  afterEach(() => {
    try {
      fs.rmSync(path.dirname(file), { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('appends and reads events (round-trip)', () => {
    const e = buildEvent({ provider: 'openai', kind: 'ask', input: 5, output: 2, ts: '2026-11-17T10:00:00.000Z' });
    expect(appendEvent(e, file)).toBe(true);
    const read = readEvents(file);
    expect(read).toHaveLength(1);
    expect(read[0]!.totalTokens).toBe(7);
  });

  it('returns empty for a missing file', () => {
    expect(readEvents(path.join(os.tmpdir(), 'nope-xyz', 'usage.jsonl'))).toEqual([]);
  });

  it('defaults under the home dir', () => {
    expect(getUsagePath().endsWith(path.join('.mcp-slim', 'usage.jsonl'))).toBe(true);
  });
});

describe('cli token flags', () => {
  it('parses token record flags', () => {
    const a = parseArgs(['token', 'record', '--provider', 'openai', '--kind', 'ask', '--input', '10', '--output', '4']);
    expect(a.command).toBe('token');
    expect(a.sub).toBe('record');
    expect(a.provider).toBe('openai');
    expect(a.kind).toBe('ask');
    expect(a.input).toBe(10);
    expect(a.output).toBe(4);
  });

  it('rejects a non-numeric count via a clean error exit', () => {
    const code = main(['token', 'record', '--provider', 'openai', '--input', 'lots']);
    expect(code).toBe(1);
  });

  it('record without provider exits 1', () => {
    expect(main(['token', 'record', '--input', '10'])).toBe(1);
  });
});
