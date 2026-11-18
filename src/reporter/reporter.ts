/**
 * Terminal reporter.
 *
 * Renders audit and compression output as readable tables and summaries.
 * Uses ANSI escapes directly (no dependencies), and disables color when
 * output is not a TTY or NO_COLOR is set.
 */

import type {
  CompressionResult,
} from '../compressor/compressor';
import type {
  ConfigTokenReport,
  SecurityFinding,
  Severity,
  TrendBucket,
  TrendPeriod,
  UsageComparison,
} from '../types';

const COLOR_ENABLED = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;

const CODES = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
} as const;

function paint(code: keyof typeof CODES, text: string): string {
  if (!COLOR_ENABLED) {
    return text;
  }
  return `${CODES[code]}${text}${CODES.reset}`;
}

const SEVERITY_COLOR: Record<Severity, keyof typeof CODES> = {
  high: 'red',
  medium: 'yellow',
  low: 'cyan',
  info: 'gray',
};

const SEVERITY_LABEL: Record<Severity, string> = {
  high: 'HIGH',
  medium: 'MED ',
  low: 'LOW ',
  info: 'INFO',
};

/** Pad a string to a fixed display width (right side). */
function pad(text: string, width: number): string {
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

/** Render the per-server token table for one config. */
export function renderTokenReport(report: ConfigTokenReport): string {
  const lines: string[] = [];
  lines.push('');
  lines.push(paint('bold', `${report.source}`) + paint('gray', `  (${report.path})`));

  if (report.servers.length === 0) {
    lines.push(paint('gray', '  No MCP servers registered.'));
    return lines.join('\n');
  }

  const nameWidth = Math.max(6, ...report.servers.map((s) => s.server.length));
  lines.push(
    '  ' + paint('dim', pad('SERVER', nameWidth) + '  ' + pad('TOKENS', 8) + '  CHARS'),
  );
  for (const s of report.servers) {
    lines.push(
      '  ' +
        pad(s.server, nameWidth) +
        '  ' +
        pad(formatNumber(s.tokens), 8) +
        '  ' +
        paint('gray', formatNumber(s.chars)),
    );
  }
  lines.push(
    '  ' +
      paint('bold', pad('TOTAL', nameWidth) + '  ' + pad(formatNumber(report.totalTokens), 8)),
  );
  return lines.join('\n');
}

/** Render the security findings for one config. */
export function renderSecurityFindings(findings: SecurityFinding[]): string {
  if (findings.length === 0) {
    return paint('green', '  ✓ No security issues found.');
  }
  const lines: string[] = [];
  for (const f of findings) {
    const badge = paint(SEVERITY_COLOR[f.severity], `[${SEVERITY_LABEL[f.severity]}]`);
    lines.push(`  ${badge} ${paint('bold', f.server)} ${paint('gray', `(${f.rule})`)}`);
    lines.push(`         ${f.message}`);
  }
  return lines.join('\n');
}

/** Render a compression summary. */
export function renderCompressionResult(source: string, result: CompressionResult): string {
  const pct = (result.savedRatio * 100).toFixed(1);
  return [
    '',
    paint('bold', source),
    `  Before: ${formatNumber(result.beforeTokens)} tokens (${formatNumber(result.beforeChars)} chars)`,
    `  After:  ${formatNumber(result.afterTokens)} tokens (${formatNumber(result.afterChars)} chars)`,
    '  ' + paint('green', `Saved:  ${formatNumber(result.savedTokens)} tokens (${pct}%)`),
  ].join('\n');
}

/** Section heading helper. */
export function heading(text: string): string {
  return paint('cyan', paint('bold', `\n${text}`));
}

/** Render a token-footprint trend table for one period. */
export function renderTrends(buckets: TrendBucket[], period: TrendPeriod): string {
  const lines: string[] = [];
  lines.push(heading(`Token footprint trend (${period})`));

  if (buckets.length === 0) {
    lines.push(paint('gray', '  No history yet. Run `mcp-slim audit` to start recording snapshots.'));
    return lines.join('\n');
  }

  const bucketWidth = Math.max(10, ...buckets.map((b) => b.bucket.length));
  lines.push(
    '  ' +
      paint(
        'dim',
        pad('PERIOD', bucketWidth) +
          '  ' +
          pad('RUNS', 6) +
          '  ' +
          pad('AVG', 8) +
          '  ' +
          pad('MIN', 8) +
          '  ' +
          pad('MAX', 8) +
          '  LAST',
      ),
  );
  for (const b of buckets) {
    lines.push(
      '  ' +
        pad(b.bucket, bucketWidth) +
        '  ' +
        pad(formatNumber(b.samples), 6) +
        '  ' +
        pad(formatNumber(b.avgTokens), 8) +
        '  ' +
        paint('gray', pad(formatNumber(b.minTokens), 8) + '  ' + pad(formatNumber(b.maxTokens), 8)) +
        '  ' +
        formatNumber(b.lastTokens),
    );
  }
  return lines.join('\n');
}

/** Plain text + color token for a signed delta (padded by the caller). */
function deltaCell(delta: number | null): { text: string; color: keyof typeof CODES } {
  if (delta === null) {
    return { text: '—', color: 'gray' };
  }
  if (delta === 0) {
    return { text: '0', color: 'gray' };
  }
  // Fewer tokens than last time is an improvement.
  return {
    text: `${delta > 0 ? '+' : '−'}${formatNumber(Math.abs(delta))}`,
    color: delta > 0 ? 'yellow' : 'green',
  };
}

/** Render the latest-vs-previous token usage table. */
export function renderUsageReport(rows: UsageComparison[]): string {
  const lines: string[] = [];
  lines.push(heading('Token usage — latest vs previous'));

  if (rows.length === 0) {
    lines.push(
      paint('gray', '  No usage recorded yet. Record with `mcp-slim token record`.'),
    );
    return lines.join('\n');
  }

  const provWidth = Math.max(8, ...rows.map((r) => r.provider.length));
  const kindWidth = Math.max(4, ...rows.map((r) => r.kind.length));
  lines.push(
    '  ' +
      paint(
        'dim',
        pad('PROVIDER', provWidth) +
          '  ' +
          pad('KIND', kindWidth) +
          '  ' +
          pad('LATEST', 9) +
          '  ' +
          pad('PREVIOUS', 9) +
          '  ' +
          pad('CHANGE', 9) +
          '  RUNS',
      ),
  );
  for (const r of rows) {
    const d = deltaCell(r.delta);
    lines.push(
      '  ' +
        pad(r.provider, provWidth) +
        '  ' +
        pad(r.kind, kindWidth) +
        '  ' +
        pad(formatNumber(r.latest), 9) +
        '  ' +
        pad(r.previous === null ? '—' : formatNumber(r.previous), 9) +
        '  ' +
        paint(d.color, pad(d.text, 9)) +
        '  ' +
        paint('gray', formatNumber(r.count)),
    );
  }
  return lines.join('\n');
}
