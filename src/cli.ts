#!/usr/bin/env node
/**
 * mcp-slim — command-line router & argument parser.
 *
 * Commands:
 *   audit      Scan configs and report token bloat + security risks.
 *   compress   Emit a minified, lossless config and report token savings.
 *   trends     Report token footprint over time (needs recorded history).
 *
 * Flags:
 *   --config <path>   Use a specific config file instead of auto-discovery.
 *   --period <p>      Trend bucket size (hourly|daily|weekly|monthly|quarterly|yearly).
 *   --history <path>  Token-footprint history file (default ~/.mcp-slim/history.jsonl).
 *   --no-history      Do not record a snapshot on `audit`.
 *   --json            Emit machine-readable JSON instead of a table.
 *   --help, -h        Show usage.
 *   --version, -v     Show version.
 */

import * as fs from 'fs';
import * as path from 'path';

import { discoverConfigs } from './scanner/config-scanner';
import { analyzeConfig } from './analyzer/token-calculator';
import { lintConfig } from './security/linter';
import { compressConfig } from './compressor/compressor';
import { appendSnapshots, readHistory } from './history/history-store';
import { TREND_PERIODS, aggregateTrends } from './history/trends';
import { appendEvent, readEvents } from './usage/usage-store';
import { buildEvent, compareUsage } from './usage/usage';
import {
  heading,
  renderCompressionResult,
  renderSecurityFindings,
  renderTokenReport,
  renderTrends,
  renderUsageReport,
} from './reporter/reporter';
import type { TokenSnapshot, TrendPeriod } from './types';

interface ParsedArgs {
  command: string | undefined;
  /** Subcommand, e.g. `record` or `report` for the `token` command. */
  sub: string | undefined;
  config: string | undefined;
  json: boolean;
  help: boolean;
  version: boolean;
  period: TrendPeriod;
  history: string | undefined;
  noHistory: boolean;
  // `token` command options.
  provider: string | undefined;
  kind: string;
  input: number | undefined;
  output: number | undefined;
  total: number | undefined;
  model: string | undefined;
  usageFile: string | undefined;
}

const USAGE = `
mcp-slim — audit MCP server configs for token bloat & security risks

Usage:
  mcp-slim <command> [options]

Commands:
  audit                 Scan configs and report token usage + security risks
  compress              Emit a minified, lossless config and report savings
  trends                Report token footprint over time from recorded history
  token record          Record an LLM token-usage event (flags or piped JSON)
  token report          Show latest vs previous token usage per provider + kind

Options:
  --config <path>       Use a specific config file (skips auto-discovery)
  --period <p>          Trend bucket: hourly|daily|weekly|monthly|quarterly|yearly (default daily)
  --history <path>      History file (default ~/.mcp-slim/history.jsonl, or $MCP_SLIM_HISTORY)
  --no-history          Do not record a snapshot when running audit
  --provider <name>     token: provider (openai|anthropic|gemini|cursor|windsurf|...)
  --kind <name>         token: interaction kind (request|ask|plan|agent; default request)
  --input/--output <n>  token: explicit prompt/completion token counts
  --total <n>           token: explicit total token count
  --model <name>        token: optional model name to tag the event
  --usage-file <path>   token: usage file (default ~/.mcp-slim/usage.jsonl, or $MCP_SLIM_USAGE)
  --json                Output machine-readable JSON
  -h, --help            Show this help
  -v, --version         Show version

Examples:
  npx mcp-slim audit
  npx mcp-slim trends --period weekly
  npx mcp-slim token record --provider openai --kind ask --input 1200 --output 340
  openai-call | npx mcp-slim token record --provider openai --kind agent
  npx mcp-slim token report
`;

/** Parse a non-negative integer token count, throwing on an invalid value. */
function parseCount(value: string | undefined, flag: string): number {
  const n = Number(value);
  if (value === undefined || !Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
    throw new Error(`Invalid ${flag} "${value ?? ''}". Expected a non-negative integer.`);
  }
  return n;
}

/** Validate and set a trend period, throwing on an unknown value. */
function setPeriod(parsed: ParsedArgs, value: string | undefined): void {
  if (value !== undefined && (TREND_PERIODS as readonly string[]).includes(value)) {
    parsed.period = value as TrendPeriod;
    return;
  }
  throw new Error(
    `Invalid --period "${value ?? ''}". Use one of: ${TREND_PERIODS.join(', ')}.`,
  );
}

/** Parse argv into a small, typed options object. */
export function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    command: undefined,
    sub: undefined,
    config: undefined,
    json: false,
    help: false,
    version: false,
    period: 'daily',
    history: undefined,
    noHistory: false,
    provider: undefined,
    kind: 'request',
    input: undefined,
    output: undefined,
    total: undefined,
    model: undefined,
    usageFile: undefined,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--help':
      case '-h':
        parsed.help = true;
        break;
      case '--version':
      case '-v':
        parsed.version = true;
        break;
      case '--json':
        parsed.json = true;
        break;
      case '--no-history':
        parsed.noHistory = true;
        break;
      case '--config':
        parsed.config = argv[++i];
        break;
      case '--history':
        parsed.history = argv[++i];
        break;
      case '--period':
        setPeriod(parsed, argv[++i]);
        break;
      case '--provider':
        parsed.provider = argv[++i];
        break;
      case '--kind':
        parsed.kind = argv[++i] ?? parsed.kind;
        break;
      case '--model':
        parsed.model = argv[++i];
        break;
      case '--usage-file':
        parsed.usageFile = argv[++i];
        break;
      case '--input':
        parsed.input = parseCount(argv[++i], '--input');
        break;
      case '--output':
        parsed.output = parseCount(argv[++i], '--output');
        break;
      case '--total':
        parsed.total = parseCount(argv[++i], '--total');
        break;
      default:
        if (arg !== undefined && arg.startsWith('--config=')) {
          parsed.config = arg.slice('--config='.length);
        } else if (arg !== undefined && arg.startsWith('--history=')) {
          parsed.history = arg.slice('--history='.length);
        } else if (arg !== undefined && arg.startsWith('--period=')) {
          setPeriod(parsed, arg.slice('--period='.length));
        } else if (arg !== undefined && arg.startsWith('--provider=')) {
          parsed.provider = arg.slice('--provider='.length);
        } else if (arg !== undefined && arg.startsWith('--kind=')) {
          parsed.kind = arg.slice('--kind='.length);
        } else if (arg !== undefined && arg.startsWith('--model=')) {
          parsed.model = arg.slice('--model='.length);
        } else if (arg !== undefined && arg.startsWith('--usage-file=')) {
          parsed.usageFile = arg.slice('--usage-file='.length);
        } else if (arg !== undefined && arg.startsWith('--input=')) {
          parsed.input = parseCount(arg.slice('--input='.length), '--input');
        } else if (arg !== undefined && arg.startsWith('--output=')) {
          parsed.output = parseCount(arg.slice('--output='.length), '--output');
        } else if (arg !== undefined && arg.startsWith('--total=')) {
          parsed.total = parseCount(arg.slice('--total='.length), '--total');
        } else if (arg !== undefined && !arg.startsWith('-') && parsed.command === undefined) {
          parsed.command = arg;
        } else if (arg !== undefined && !arg.startsWith('-') && parsed.sub === undefined) {
          parsed.sub = arg;
        }
        break;
    }
  }

  return parsed;
}

function readVersion(): string {
  try {
    const pkgPath = path.join(__dirname, '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** `audit` command. Returns a process exit code. */
function runAudit(args: ParsedArgs): number {
  const configs = discoverConfigs(args.config);

  if (configs.length === 0) {
    process.stderr.write('No MCP config files found. Pass --config <path> to specify one.\n');
    return 1;
  }

  const results = configs.map((config) => ({
    tokens: analyzeConfig(config),
    findings: lintConfig(config),
  }));

  // Record a token-footprint snapshot so `trends` can show change over time.
  if (!args.noHistory) {
    const now = new Date().toISOString();
    const snapshots: TokenSnapshot[] = results.map((r) => ({
      ts: now,
      source: r.tokens.source,
      path: r.tokens.path,
      totalTokens: r.tokens.totalTokens,
      serverCount: r.tokens.servers.length,
    }));
    appendSnapshots(snapshots, args.history);
  }

  if (args.json) {
    process.stdout.write(JSON.stringify(results, null, 2) + '\n');
    return results.some((r) => r.findings.some((f) => f.severity === 'high')) ? 2 : 0;
  }

  let highCount = 0;
  for (const { tokens, findings } of results) {
    process.stdout.write(renderTokenReport(tokens) + '\n');
    process.stdout.write(heading('Security') + '\n');
    process.stdout.write(renderSecurityFindings(findings) + '\n');
    highCount += findings.filter((f) => f.severity === 'high').length;
  }

  // Non-zero exit when high-severity issues exist, so CI can gate on it.
  return highCount > 0 ? 2 : 0;
}

/** `compress` command. Returns a process exit code. */
function runCompress(args: ParsedArgs): number {
  const configs = discoverConfigs(args.config);

  if (configs.length === 0) {
    process.stderr.write('No MCP config files found. Pass --config <path> to specify one.\n');
    return 1;
  }

  if (args.json) {
    const out = configs.map((config) => ({
      source: config.source,
      path: config.path,
      ...compressConfig(config),
    }));
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    return 0;
  }

  for (const config of configs) {
    const result = compressConfig(config);
    process.stdout.write(renderCompressionResult(config.source, result) + '\n');
  }
  return 0;
}

/** `trends` command. Returns a process exit code. */
function runTrends(args: ParsedArgs): number {
  const snapshots = readHistory(args.history);
  const buckets = aggregateTrends(snapshots, args.period);

  if (args.json) {
    process.stdout.write(JSON.stringify({ period: args.period, buckets }, null, 2) + '\n');
    return 0;
  }

  process.stdout.write(renderTrends(buckets, args.period) + '\n');
  return 0;
}

/** Read piped stdin as a string, or '' when nothing is piped. */
function readStdin(): string {
  if (process.stdin.isTTY) {
    return '';
  }
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

/** `token record` — append one usage event from flags and/or piped JSON. */
function runTokenRecord(args: ParsedArgs): number {
  if (!args.provider) {
    process.stderr.write('token record: --provider is required (e.g. --provider openai).\n');
    return 1;
  }

  let raw: Record<string, unknown> | undefined;
  const hasExplicit = args.input !== undefined || args.output !== undefined || args.total !== undefined;
  if (!hasExplicit) {
    const piped = readStdin().trim();
    if (piped.length > 0) {
      try {
        const parsed = JSON.parse(piped) as unknown;
        // Accept either a bare usage object or a full response with a `usage` field.
        const obj = parsed as Record<string, unknown>;
        raw = (obj.usage as Record<string, unknown>) ?? (obj.usageMetadata as Record<string, unknown>) ?? obj;
      } catch {
        process.stderr.write('token record: piped input was not valid JSON.\n');
        return 1;
      }
    }
  }

  if (!hasExplicit && !raw) {
    process.stderr.write(
      'token record: provide --input/--output/--total, or pipe the response usage JSON.\n',
    );
    return 1;
  }

  const event = buildEvent({
    provider: args.provider,
    kind: args.kind,
    ...(args.model ? { model: args.model } : {}),
    ...(args.input !== undefined ? { input: args.input } : {}),
    ...(args.output !== undefined ? { output: args.output } : {}),
    ...(args.total !== undefined ? { total: args.total } : {}),
    ...(raw ? { raw } : {}),
  });

  const ok = appendEvent(event, args.usageFile);
  if (!ok) {
    process.stderr.write('token record: failed to write the usage file.\n');
    return 1;
  }

  if (args.json) {
    process.stdout.write(JSON.stringify(event, null, 2) + '\n');
  } else {
    process.stdout.write(
      `Recorded ${event.provider} ${event.kind}: ${event.totalTokens} tokens ` +
        `(in ${event.inputTokens}, out ${event.outputTokens}).\n`,
    );
  }
  return 0;
}

/** `token report` — show latest vs previous usage per provider + kind. */
function runTokenReport(args: ParsedArgs): number {
  let events = readEvents(args.usageFile);
  if (args.provider) {
    events = events.filter((e) => e.provider === args.provider);
  }
  const rows = compareUsage(events);

  if (args.json) {
    process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
    return 0;
  }
  process.stdout.write(renderUsageReport(rows) + '\n');
  return 0;
}

/** `token` command router. Defaults to `report`. */
function runToken(args: ParsedArgs): number {
  switch (args.sub) {
    case 'record':
      return runTokenRecord(args);
    case undefined:
    case 'report':
      return runTokenReport(args);
    default:
      process.stderr.write(`Unknown token subcommand: ${args.sub}. Use "record" or "report".\n`);
      return 1;
  }
}

/** Entry point. Returns a process exit code (does not call process.exit). */
export function main(argv: string[] = process.argv.slice(2)): number {
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`Error: ${(err as Error).message}\n`);
    return 1;
  }

  if (args.version) {
    process.stdout.write(readVersion() + '\n');
    return 0;
  }

  if (args.help || args.command === undefined) {
    process.stdout.write(USAGE);
    return args.command === undefined && !args.help ? 1 : 0;
  }

  try {
    switch (args.command) {
      case 'audit':
        return runAudit(args);
      case 'compress':
        return runCompress(args);
      case 'trends':
        return runTrends(args);
      case 'token':
        return runToken(args);
      default:
        process.stderr.write(`Unknown command: ${args.command}\n`);
        process.stdout.write(USAGE);
        return 1;
    }
  } catch (err) {
    process.stderr.write(`Error: ${(err as Error).message}\n`);
    return 1;
  }
}

// Only run when invoked directly (not when imported by tests).
if (require.main === module) {
  process.exit(main());
}
