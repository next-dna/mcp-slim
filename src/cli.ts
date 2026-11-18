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
import { computeScorecard, badgeMarkdown } from './security/scorecard';
import {
  heading,
  renderCompressionResult,
  renderScorecard,
  renderSecurityFindings,
  renderTokenReport,
  renderTrends,
} from './reporter/reporter';
import type { SecurityFinding, TokenSnapshot, TrendPeriod } from './types';

interface ParsedArgs {
  command: string | undefined;
  config: string | undefined;
  json: boolean;
  help: boolean;
  version: boolean;
  period: TrendPeriod;
  history: string | undefined;
  noHistory: boolean;
  badge: boolean;
}

const USAGE = `
mcp-slim — audit MCP server configs for token bloat & security risks

Usage:
  mcp-slim <command> [options]

Commands:
  audit                 Scan configs and report token usage + security risks
  compress              Emit a minified, lossless config and report savings
  trends                Report token footprint over time from recorded history

Options:
  --config <path>       Use a specific config file (skips auto-discovery)
  --period <p>          Trend bucket: hourly|daily|weekly|monthly|quarterly|yearly (default daily)
  --history <path>      History file (default ~/.mcp-slim/history.jsonl, or $MCP_SLIM_HISTORY)
  --no-history          Do not record a snapshot when running audit
  --badge               audit: print a shields.io security-grade badge for your README
  --json                Output machine-readable JSON
  -h, --help            Show this help
  -v, --version         Show version

Examples:
  npx mcp-slim audit
  npx mcp-slim audit --config ./claude_desktop_config.json
  npx mcp-slim trends --period weekly
  npx mcp-slim compress --json
`;

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
    config: undefined,
    json: false,
    help: false,
    version: false,
    period: 'daily',
    history: undefined,
    noHistory: false,
    badge: false,
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
      case '--badge':
        parsed.badge = true;
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
      default:
        if (arg !== undefined && arg.startsWith('--config=')) {
          parsed.config = arg.slice('--config='.length);
        } else if (arg !== undefined && arg.startsWith('--history=')) {
          parsed.history = arg.slice('--history='.length);
        } else if (arg !== undefined && arg.startsWith('--period=')) {
          setPeriod(parsed, arg.slice('--period='.length));
        } else if (arg !== undefined && !arg.startsWith('-') && parsed.command === undefined) {
          parsed.command = arg;
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

  const results = configs.map((config) => {
    const findings = lintConfig(config);
    return {
      tokens: analyzeConfig(config),
      findings,
      scorecard: computeScorecard(findings),
    };
  });

  // Overall scorecard across all scanned configs (used for the README badge).
  const allFindings: SecurityFinding[] = results.flatMap((r) => r.findings);
  const overall = computeScorecard(allFindings);

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
    const payload = args.badge
      ? { results, badge: badgeMarkdown(overall) }
      : results;
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
    return results.some((r) => r.findings.some((f) => f.severity === 'high')) ? 2 : 0;
  }

  let highCount = 0;
  for (const { tokens, findings, scorecard } of results) {
    process.stdout.write(renderTokenReport(tokens) + '\n');
    process.stdout.write(renderScorecard(scorecard) + '\n');
    process.stdout.write(heading('Security') + '\n');
    process.stdout.write(renderSecurityFindings(findings) + '\n');
    highCount += findings.filter((f) => f.severity === 'high').length;
  }

  if (args.badge) {
    process.stdout.write(heading('Badge (paste into your README)') + '\n');
    process.stdout.write('  ' + badgeMarkdown(overall) + '\n');
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
