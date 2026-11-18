/**
 * Usage normalization and latest-vs-previous comparison.
 *
 * Each LLM provider reports token usage under different field names; this
 * module maps them to a common `{ input, output, total }` shape and builds the
 * comparison the `token report` command renders. Zero runtime dependencies.
 */

import type { UsageComparison, UsageEvent } from '../types';

export interface NormalizedUsage {
  input: number;
  output: number;
  total: number;
}

function num(raw: Record<string, unknown>, key: string): number | undefined {
  const v = raw[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/**
 * Map a provider's raw usage object (e.g. the `usage` field of an API response)
 * to `{ input, output, total }`. Unknown providers fall back to common keys.
 */
export function normalizeUsage(provider: string, raw: Record<string, unknown>): NormalizedUsage {
  let input: number | undefined;
  let output: number | undefined;
  let total: number | undefined;

  switch (provider.toLowerCase()) {
    case 'openai':
      input = num(raw, 'prompt_tokens');
      output = num(raw, 'completion_tokens');
      total = num(raw, 'total_tokens');
      break;
    case 'anthropic':
    case 'claude':
      input = num(raw, 'input_tokens');
      output = num(raw, 'output_tokens');
      break;
    case 'gemini':
    case 'google':
      input = num(raw, 'promptTokenCount');
      output = num(raw, 'candidatesTokenCount');
      total = num(raw, 'totalTokenCount');
      break;
    default:
      break;
  }

  // Generic fallbacks for any provider / manual entry.
  input = input ?? num(raw, 'inputTokens') ?? num(raw, 'input') ?? 0;
  output = output ?? num(raw, 'outputTokens') ?? num(raw, 'output') ?? 0;
  total = total ?? num(raw, 'totalTokens') ?? num(raw, 'total') ?? input + output;

  return { input, output, total };
}

export interface BuildEventInput {
  provider: string;
  kind: string;
  model?: string;
  /** Explicit counts (take precedence over `raw`). */
  input?: number;
  output?: number;
  total?: number;
  /** Raw provider usage object, e.g. piped from an API response. */
  raw?: Record<string, unknown>;
  /** Timestamp override (defaults to now); used by tests. */
  ts?: string;
}

/** Build a {@link UsageEvent} from explicit counts and/or a raw usage object. */
export function buildEvent(opts: BuildEventInput): UsageEvent {
  const fromRaw = opts.raw ? normalizeUsage(opts.provider, opts.raw) : undefined;
  const input = opts.input ?? fromRaw?.input ?? 0;
  const output = opts.output ?? fromRaw?.output ?? 0;
  const total = opts.total ?? fromRaw?.total ?? input + output;
  return {
    ts: opts.ts ?? new Date().toISOString(),
    provider: opts.provider,
    kind: opts.kind,
    inputTokens: input,
    outputTokens: output,
    totalTokens: total,
    ...(opts.model ? { model: opts.model } : {}),
  };
}

/**
 * Compare the latest usage against the previous one, grouped by provider+kind.
 *
 * Events are ordered by timestamp within each group so "latest" and "previous"
 * are the two most recent recordings.
 */
export function compareUsage(events: UsageEvent[]): UsageComparison[] {
  const groups = new Map<string, UsageEvent[]>();
  for (const e of events) {
    const key = `${e.provider}\u0000${e.kind}`;
    const list = groups.get(key);
    if (list) {
      list.push(e);
    } else {
      groups.set(key, [e]);
    }
  }

  const result: UsageComparison[] = [];
  for (const list of groups.values()) {
    list.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
    const latest = list[list.length - 1]!;
    const prev = list.length > 1 ? list[list.length - 2]! : undefined;
    result.push({
      provider: latest.provider,
      kind: latest.kind,
      latest: latest.totalTokens,
      previous: prev ? prev.totalTokens : null,
      delta: prev ? latest.totalTokens - prev.totalTokens : null,
      count: list.length,
    });
  }

  result.sort((a, b) =>
    a.provider === b.provider
      ? a.kind < b.kind
        ? -1
        : a.kind > b.kind
          ? 1
          : 0
      : a.provider < b.provider
        ? -1
        : 1,
  );
  return result;
}
