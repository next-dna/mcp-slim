/**
 * Security linter.
 *
 * Inspects each server's command, arguments, environment and transport for
 * common risk patterns: shell execution, broad filesystem scopes, unpinned
 * package/remote endpoints and secrets stored in plaintext.
 *
 * These are heuristics meant to prompt review, not a proof of vulnerability.
 */

import * as os from 'os';

import type { McpConfigFile, McpServerConfig, SecurityFinding, Severity } from '../types';

/** Executables that run arbitrary shell commands. */
const SHELL_BINARIES = new Set(['sh', 'bash', 'zsh', 'cmd', 'cmd.exe', 'powershell', 'pwsh']);

/** Package runners that fetch and execute code on demand. */
const PACKAGE_RUNNERS = new Set(['npx', 'uvx', 'bunx', 'pnpm', 'dlx']);

/** Env var name fragments that usually indicate a secret. */
const SECRET_HINTS = ['token', 'secret', 'password', 'passwd', 'apikey', 'api_key', 'access_key', 'private_key'];

/** Severity ranking used for sorting findings most-severe first. */
const SEVERITY_RANK: Record<Severity, number> = { high: 3, medium: 2, low: 1, info: 0 };

function basename(command: string): string {
  const normalized = command.replace(/\\/g, '/');
  const segment = normalized.slice(normalized.lastIndexOf('/') + 1);
  return segment.toLowerCase();
}

/** Lint a single server definition, returning any findings. */
export function lintServer(name: string, server: McpServerConfig): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const args = Array.isArray(server.args) ? server.args : [];
  const command = typeof server.command === 'string' ? server.command : '';
  const cmd = basename(command);

  // 1. Direct shell execution.
  if (SHELL_BINARIES.has(cmd)) {
    findings.push({
      server: name,
      severity: 'high',
      rule: 'shell-exec',
      message: `Launches a shell (\`${command}\`), which can run arbitrary commands.`,
    });
  }
  if (args.some((a) => a === '-c' || a === '/c' || a === '/C')) {
    findings.push({
      server: name,
      severity: 'high',
      rule: 'shell-command-flag',
      message: 'Passes an inline command flag (-c/-C), executing arbitrary commands.',
    });
  }

  // 2. Unpinned package runners (npx/uvx/... without a version).
  if (PACKAGE_RUNNERS.has(cmd)) {
    const pkg = args.find((a) => !a.startsWith('-'));
    const unpinned =
      !pkg || /@latest$/.test(pkg) || !/@\d/.test(pkg);
    if (unpinned) {
      findings.push({
        server: name,
        severity: 'medium',
        rule: 'unpinned-package',
        message: `Runs \`${cmd}\` without a pinned version${pkg ? ` (\`${pkg}\`)` : ''}; a compromised release would run automatically.`,
      });
    }
  }

  // 3. Broad filesystem scope.
  const home = os.homedir();
  const broadRoots = args.filter((a) => a === '/' || a === '~' || a === home || /^[A-Za-z]:\\?$/.test(a));
  if (broadRoots.length > 0) {
    findings.push({
      server: name,
      severity: 'high',
      rule: 'broad-filesystem',
      message: `Grants filesystem access to a broad root (${broadRoots.join(', ')}).`,
    });
  }

  // 4. Remote transports.
  if (typeof server.url === 'string' && server.url.length > 0) {
    if (server.url.startsWith('http://')) {
      findings.push({
        server: name,
        severity: 'high',
        rule: 'insecure-transport',
        message: `Uses an unencrypted http:// endpoint (${server.url}).`,
      });
    } else if (!server.url.startsWith('https://')) {
      findings.push({
        server: name,
        severity: 'low',
        rule: 'unknown-transport',
        message: `Remote endpoint uses a non-standard scheme (${server.url}).`,
      });
    }
  }

  // 5. Secrets stored in plaintext env.
  if (server.env && typeof server.env === 'object') {
    for (const key of Object.keys(server.env)) {
      const lower = key.toLowerCase();
      if (SECRET_HINTS.some((hint) => lower.includes(hint))) {
        findings.push({
          server: name,
          severity: 'medium',
          rule: 'plaintext-secret',
          message: `Stores a likely secret in plaintext (env var \`${key}\`).`,
        });
      }
    }
  }

  return findings;
}

/** Lint every server in a config file, sorted most-severe first. */
export function lintConfig(config: McpConfigFile): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  for (const [name, server] of Object.entries(config.servers)) {
    findings.push(...lintServer(name, server));
  }
  findings.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
  return findings;
}
