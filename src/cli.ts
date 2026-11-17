#!/usr/bin/env node
/**
 * mcp-slim — command-line router & argument parser.
 *
 * Commands:
 *   audit      Scan configs and report token bloat + security risks.
 *   compress   Emit a minified, lossless config and report token savings.
 *
 * Flags:
 *   --config <path>   Use a specific config file instead of auto-discovery.
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
import {
  heading,
  renderCompressionResult,
  renderSecurityFindings,
  renderTokenReport,
} from './reporter/reporter';

interface ParsedArgs {
  command: string | undefined;
  config: string | undefined;
  json: boolean;
  help: boolean;
  version: boolean;
}

const USAGE = `
mcp-slim — audit MCP server configs for token bloat & security risks

Usage:
  mcp-slim <command> [options]

Commands:
  audit                 Scan configs and report token usage + security risks
  compress              Emit a minified, lossless config and report savings

Options:
  --config <path>       Use a specific config file (skips auto-discovery)
  --json                Output machine-readable JSON
  -h, --help            Show this help
  -v, --version         Show version

Examples:
  npx mcp-slim audit
  npx mcp-slim audit --config ./claude_desktop_config.json
  npx mcp-slim compress --json
`;

/** Parse argv into a small, typed options object. */
export function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    command: undefined,
    config: undefined,
    json: false,
    help: false,
    version: false,
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
      case '--config':
        parsed.config = argv[++i];
        break;
      default:
        if (arg !== undefined && arg.startsWith('--config=')) {
          parsed.config = arg.slice('--config='.length);
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

  const results = configs.map((config) => ({
    tokens: analyzeConfig(config),
    findings: lintConfig(config),
  }));

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

/** Entry point. Returns a process exit code (does not call process.exit). */
export function main(argv: string[] = process.argv.slice(2)): number {
  const args = parseArgs(argv);

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
